const Hyperswarm = require('hyperswarm')
const BluetoothSwarm = require('ble-swarm')
const FramedStream = require('framed-stream')
const ReadyResource = require('ready-resource')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const protocol = require('./protocol.js')

// en Linux inyectamos nuestro puente BlueZ; en macOS/Android ble-swarm trae
// backend nativo (null deja su default); donde no hay BLE queda unsupported
const bleBackend = require('#ble-backend')

const NAMESPACE = 'multigame-pears/v1/'

// Hyperswarm solo repite la busqueda por su cuenta cada varios minutos. En un
// lobby el rival entra segundos despues, asi que mientras no haya con quien
// jugar insistimos — pero con backoff.
//
// Sobre el "refresh thrashing": se dice que llamar refresh() seguido cancela
// handshakes UDX en vuelo. Verificado en hyperswarm/lib/peer-discovery.js:159,
// eso NO pasa por este camino. `_activeQuery.destroy()` corre solo cuando
// CAMBIAN los flags server/client, y el lobby siempre entra con los dos en true
// y nunca los cambia. Con los roles iguales, un refresh en vuelo devuelve la
// misma promesa (`if (this._currentRefresh) return this._currentRefresh`): la
// llamada es un no-op, no una cancelacion.
//
// Lo que si es real: como isServer es true, cada refresh es un `dht.announce`
// completo a los ~20 nodos mas cercanos, sobre el mismo socket UDP que usa el
// holepunching. A 3 segundos fijos eso es ruido continuo.
//
// Y desde que hay un refresh inmediato despues del flush (ver _open), este
// intervalo dejo de estar en el camino critico: el que llega ultimo encuentra al
// otro solo, y este loop es apenas una red de seguridad para cuando su dial
// falla. Por eso el backoff puede ser generoso sin costar nada.
const HUNT_MIN = 3000
const HUNT_MAX = 15000
const HUNT_GROWTH = 1.5

// Cuando dos peers se marcan a la vez quedan dos sockets cruzados; hyperswarm
// mata uno ("Duplicate connection") y entrega el sobreviviente como conexion
// nueva. Tras perder el socket esperamos el reemplazo este margen antes de
// declarar al rival ido — si no, cada swap reiniciaria la partida. El redial
// tras un corte real tarda ~5s (backoff de hyperswarm), de ahi el margen.
const RECONNECT_GRACE = 10000

// cada cuanto medimos el RTT contra el rival. Es el numero que decide el input
// delay de los juegos en tiempo real, y va a la vista en la UI: la latencia
// deja de ser un misterio y pasa a ser un dato.
const PING_INTERVAL = 2000

// suavizado exponencial del RTT: una medicion suelta sobre BLE tiene un jitter
// del orden del propio connection interval, y un input delay que salta con cada
// muestra se siente peor que uno estable un poco mas alto.
const RTT_ALPHA = 0.3

// mensajes que caducan: no se encolan, no se numeran y no se reenvian
const TRANSIENT = new Set([protocol.T.PING, protocol.T.PONG, protocol.T.INPUT, protocol.T.SYNC])

// Cuantos mensajes con numero guardamos para poder reenviarlos si el socket se
// reemplaza. Alcanza de sobra para el handshake y las ultimas jugadas.
const REPLAY_MAX = 32

// One topic per game, so joining a game is the matchmaking.
module.exports = class Lobby extends ReadyResource {
  // `bootstrap` y `bluetooth` existen para poder testear: con una DHT local el
  // emparejamiento se prueba en milisegundos y sin tocar la red real, y sin
  // radio los tests no dependen de que la maquina tenga Bluetooth.
  constructor(gameId, room, { bootstrap = undefined, bluetooth = true, huntMin = HUNT_MIN } = {}) {
    super()

    this.gameId = gameId
    this.room = room
    this.topic = crypto.data(b4a.from(NAMESPACE + gameId + '/' + room))
    this.swarm = new Hyperswarm(bootstrap === undefined ? {} : { bootstrap })
    this.useBluetooth = bluetooth
    this.bt = null
    this.peer = null
    this.discovery = null
    this.rtt = null
    this._hunt = null
    this._huntMin = huntMin
    this._huntDelay = huntMin
    this._lostKey = null
    this._lostTimer = null
    this._lostCountdown = null
    this._ping = null
    this._lastVia = undefined
    this._outbox = []

    // Reliability minima sobre el swap de sockets.
    //
    // Cuando los dos peers se marcan a la vez quedan dos sockets cruzados,
    // hyperswarm mata uno y entrega el sobreviviente. Lo que se habia escrito en
    // el perdedor se pierde con el destroy() — y eso incluye el handshake
    // (HELLO, CONTENT_HAVE, MATCH), asi que el rival se quedaba sin saber en que
    // arena jugar. Con el refresh inmediato tras el flush los dos se descubren
    // en el mismo instante, o sea que la carrera pasa casi siempre.
    //
    // Cada mensaje no efimero lleva un numero: el emisor guarda los ultimos para
    // reenviarlos al cambiar de socket, y el receptor descarta los que ya vio.
    // De paso todo el protocolo queda idempotente, que es lo que hace seguro el
    // reenvio.
    this._seq = 0
    this._seen = 0
    this._replay = []
  }

  _open() {
    this.swarm.on('connection', (conn) => this._onconnection(conn, 'internet'))
    this.discovery = this.swarm.join(this.topic, { client: true, server: true })

    // BLE arranca ya: sin internet es el unico camino, y flushed() no resuelve
    this._startBluetooth()

    // Recien empezamos a insistir cuando el anuncio salio de verdad. Antes de
    // eso refresh() coalesce con el que ya esta en vuelo y no hace nada, asi
    // que polear era ruido sin efecto. Y como no se bloquea esperando, sin
    // internet el lobby sigue vivo por Bluetooth.
    this.discovery.flushed().then(
      () => {
        this._setOnline(true)
        // Un refresh INMEDIATO en cuanto nuestro propio anuncio termino, antes
        // de empezar a esperar.
        //
        // Medido (test/bench-pairing.js): sin esto, el tiempo de emparejamiento
        // seguia al intervalo de busqueda 1 a 1 — 500ms de intervalo daba 512ms,
        // 6000ms daba 6007ms. O sea que el primer anuncio NUNCA emparejaba: los
        // dos lados anuncian en paralelo, ninguno ve al otro todavia, y quien
        // emparejaba era siempre el primer refresh.
        //
        // Anunciar y despues mirar de nuevo corrige justo eso, y ademas hace que
        // el que llega ultimo —el caso normal de un lobby, alguien entra a una
        // sala que ya existe— empareje de una porque el registro del otro ya
        // esta guardado.
        this.discovery?.refresh().catch(() => {})
        this._startHunting()
      },
      () => this._setOnline(false)
    )
  }

  // Que el anuncio en la DHT haya salido significa que hay internet, y eso
  // cambia cuanto tiene que insistir el BLE. Sin esta senal ble-swarm se queda
  // en `_online: false` y reinicia el scan cada 5s para siempre
  // (SCAN_RESTART_LONELY), un startDiscovery/stopDiscovery por D-Bus cada 5
  // segundos durante TODA la partida — robandole radio al link que ya tenemos.
  // Con online:true pasa a un duty cycle de 5s cada 55s.
  _setOnline(online) {
    if (this.bt === null || this.closing !== null) return
    try {
      this.bt.setOnline(online)
    } catch {}
  }

  _startBluetooth() {
    if (!this.useBluetooth) return
    try {
      const opts = { keyPair: this.swarm.keyPair, topic: this.topic, pipe: 'gatt' }
      if (bleBackend !== null) opts.backend = bleBackend
      const bt = new BluetoothSwarm(opts)
      if (!bt.supported) return
      this.bt = bt
      bt.on('connection', (conn) => this._onconnection(conn, 'bluetooth'))
      bt.start().catch(() => {})
    } catch {
      this.bt = null // sin radio no hay BLE, el lobby sigue por internet
    }
  }

  _startHunting() {
    if (this._hunt !== null || this.peer !== null || this.closing !== null) return
    this._huntDelay = this._huntMin
    this._scheduleHunt()
  }

  _scheduleHunt() {
    this._hunt = setTimeout(() => {
      this._hunt = null
      if (this.peer !== null || this.closing !== null) return
      this.discovery?.refresh().catch(() => {})
      this._huntDelay = Math.min(Math.round(this._huntDelay * HUNT_GROWTH), HUNT_MAX)
      this._scheduleHunt()
    }, this._huntDelay)
    if (this._hunt.unref) this._hunt.unref()
  }

  _stopHunting() {
    if (this._hunt === null) return
    clearTimeout(this._hunt)
    this._hunt = null
  }

  async _close() {
    this._stopHunting()
    this._stopPinging()
    this._clearLossTimer()
    this._lostKey = null
    this._outbox = []
    this.peer?.conn.destroy()
    this.peer = null
    if (this.bt !== null) await this.bt.close().catch(() => {})
    await this.swarm.destroy()
  }

  _onconnection(conn, via) {
    conn.on('error', () => {})

    if (this.peer !== null) {
      // mismo rival por otro socket: swap de dedup o cambio de transporte.
      // bluetooth le gana a internet; nunca degradar de bluetooth a internet.
      if (b4a.equals(conn.remotePublicKey, this.peer.conn.remotePublicKey)) {
        if (this.peer.via === 'bluetooth' && via === 'internet') {
          conn.destroy()
          return
        }
        return this._attach(conn, via)
      }
      // already playing — turn the newcomer away rather than juggling tables
      conn.destroy()
      return
    }

    // el rival que acabamos de perder volvio: partida intacta, ni paired ni peer-lost
    const reconnect = this._lostKey !== null && b4a.equals(conn.remotePublicKey, this._lostKey)

    // rival nuevo: los contadores arrancan de cero en las dos puntas
    if (!reconnect) {
      this._seq = 0
      this._seen = 0
      this._replay = []
    }

    this._attach(conn, via)
    if (reconnect) return

    // both ends need to agree on who moves first without a round trip
    const first = b4a.compare(conn.publicKey, conn.remotePublicKey) < 0
    this.emit('paired', {
      first,
      seed: seedFrom(conn.publicKey, conn.remotePublicKey),
      remoteKey: conn.remotePublicKey,
      via
    })
  }

  _attach(conn, via) {
    const old = this.peer
    const prevVia = old !== null ? old.via : this._lastVia
    const pipe = new FramedStream(conn)
    this.peer = { conn, pipe, via }
    this._lastVia = via
    this._clearLossTimer()
    this._lostKey = null
    this._stopHunting()

    // el stream emite 'error' al cerrarse; sin listener tumba el proceso
    pipe.on('error', () => {})

    pipe.on('data', (data) => this._onframe(data))

    conn.once('close', () => this._ondrop(conn))

    // su handler de close no dispara _ondrop porque this.peer ya apunta al nuevo
    if (old !== null) old.conn.destroy()

    while (this._outbox.length > 0) this.peer.pipe.write(this._outbox.shift())

    // Socket reemplazado (dedup cruzado o cambio de transporte): lo que se
    // escribio en el anterior puede no haber salido nunca. El receptor descarta
    // por numero lo que ya vio, asi que reenviar es seguro.
    if (old !== null) {
      for (const data of this._replay) this.peer.pipe.write(data)
    }

    this._startPinging()

    // cambio de transporte a mitad de partida (ej: wifi muerto → bluetooth)
    if (prevVia !== undefined && prevVia !== via) {
      this.rtt = null // el RTT de BLE y el de internet no se parecen en nada
      this.emit('via', via)
    }
  }

  _onframe(data) {
    const msg = protocol.decode(data)
    if (msg === null) return

    // Numerado y ya visto: es un reenvio tras un swap de socket. Un peer viejo
    // no numera nada, y ahi no hay nada que descartar.
    if (typeof msg.n === 'number') {
      if (msg.n <= this._seen) return
      this._seen = msg.n
      delete msg.n // es del transporte: la app no tiene por que verlo
    }

    // ping/pong es cosa del transporte: se responde aca y no sube a la UI
    if (msg.t === protocol.T.PING) {
      this.send({ t: protocol.T.PONG, ts: msg.ts })
      return
    }

    if (msg.t === protocol.T.PONG) {
      this._onpong(msg.ts)
      return
    }

    this.emit('message', msg)
  }

  // el ts viaja y vuelve, asi que el RTT sale de nuestro propio reloj: no hace
  // falta sincronizar relojes con el rival para medirlo
  _onpong(ts) {
    if (typeof ts !== 'number') return
    const sample = Date.now() - ts
    if (sample < 0) return
    this.rtt =
      this.rtt === null ? sample : Math.round(RTT_ALPHA * sample + (1 - RTT_ALPHA) * this.rtt)
    this.emit('rtt', this.rtt)
  }

  _startPinging() {
    if (this._ping !== null) return
    const beat = () => {
      if (this.peer === null || this.closing !== null) return
      this.send({ t: protocol.T.PING, ts: Date.now() })
    }
    beat()
    this._ping = setInterval(beat, PING_INTERVAL)
    if (this._ping.unref) this._ping.unref()
  }

  _stopPinging() {
    if (this._ping === null) return
    clearInterval(this._ping)
    this._ping = null
  }

  _ondrop(conn) {
    if (this.peer?.conn !== conn) return
    this._lostKey = conn.remotePublicKey
    this.peer = null
    this.rtt = null
    this._stopPinging()
    // Buscar de una, no dentro de 3 segundos: la ventana de gracia son 10s y el
    // rival que se esta reconectando puede aparecer en cualquier momento. Es la
    // misma razon por la que hay un refresh inmediato tras el flush inicial.
    this.discovery?.refresh().catch(() => {})
    this._startHunting()

    // diez segundos de pantalla congelada se leen como "se colgo". Contar en
    // voz alta convierte la espera en algo que se entiende.
    let left = Math.round(RECONNECT_GRACE / 1000)
    this.emit('reconnecting', left)
    this._lostCountdown = setInterval(() => {
      left -= 1
      if (left > 0) this.emit('reconnecting', left)
    }, 1000)
    if (this._lostCountdown.unref) this._lostCountdown.unref()

    this._lostTimer = setTimeout(() => {
      this._lostTimer = null
      this._lostKey = null
      this._outbox = []
      this._clearCountdown()
      this.emit('peer-lost')
    }, RECONNECT_GRACE)
    if (this._lostTimer.unref) this._lostTimer.unref()
  }

  _clearCountdown() {
    if (this._lostCountdown === null) return
    clearInterval(this._lostCountdown)
    this._lostCountdown = null
  }

  _clearLossTimer() {
    this._clearCountdown()
    if (this._lostTimer === null) return
    clearTimeout(this._lostTimer)
    this._lostTimer = null
  }

  send(msg) {
    // los efimeros van sin numero: se descartan solos y reenviarlos mentiria
    // sobre la latencia o movería la partida dos veces
    if (!TRANSIENT.has(msg.t)) msg = { ...msg, n: ++this._seq }

    const data = protocol.encode(msg)

    if (msg.n !== undefined) {
      this._replay.push(data)
      if (this._replay.length > REPLAY_MAX) this._replay.shift()
    }

    if (this.peer !== null) {
      this.peer.pipe.write(data)
      return true
    }
    // sin socket pero dentro del margen de reconexion: encolar y entregar al
    // volver. Solo lo que sigue siendo cierto mas tarde: un movimiento por
    // turnos si, pero un input de snake sellado con su tick, un hash de
    // sincronia o un ping solo tienen sentido en el momento — entregarlos
    // despues desincroniza la partida o miente sobre la latencia.
    if (this._lostKey !== null && !TRANSIENT.has(msg.t)) {
      this._outbox.push(data)
      return true
    }
    return false
  }
}

// Semilla compartida para los juegos con azar, derivada de las dos pubkeys
// ordenadas: las dos maquinas calculan la misma sin intercambiar un solo byte,
// igual que el truco de `first`. Sin esto habria que negociar la semilla, y una
// negociacion es un round-trip mas antes de poder empezar a jugar.
function seedFrom(a, b) {
  const [lo, hi] = b4a.compare(a, b) < 0 ? [a, b] : [b, a]
  const digest = crypto.data(b4a.concat([lo, hi]))
  return digest.readUInt32LE(0) >>> 0
}
