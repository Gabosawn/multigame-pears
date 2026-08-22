const Hyperswarm = require('hyperswarm')
const BluetoothSwarm = require('ble-swarm')
const FramedStream = require('framed-stream')
const ReadyResource = require('ready-resource')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

// en Linux inyectamos nuestro puente BlueZ; en macOS/Android ble-swarm trae
// backend nativo (null deja su default); donde no hay BLE queda unsupported
const bleBackend = require('#ble-backend')

const NAMESPACE = 'multigame-pears/v1/'

// hyperswarm solo repite la busqueda cada 10 min. En un lobby el rival entra
// segundos despues, asi que mientras no haya con quien jugar buscamos seguido.
const HUNT_INTERVAL = 3000

// Cuando dos peers se marcan a la vez quedan dos sockets cruzados; hyperswarm
// mata uno ("Duplicate connection") y entrega el sobreviviente como conexion
// nueva. Tras perder el socket esperamos el reemplazo este margen antes de
// declarar al rival ido — si no, cada swap reiniciaria la partida. El redial
// tras un corte real tarda ~5s (backoff de hyperswarm), de ahi el margen.
const RECONNECT_GRACE = 10000

// One topic per game, so joining a game is the matchmaking.
module.exports = class Lobby extends ReadyResource {
  constructor(gameId, room) {
    super()

    this.gameId = gameId
    this.room = room
    this.topic = crypto.data(b4a.from(NAMESPACE + gameId + '/' + room))
    this.swarm = new Hyperswarm()
    this.bt = null
    this.peer = null
    this.discovery = null
    this._hunt = null
    this._lostKey = null
    this._lostTimer = null
    this._lastVia = undefined
    this._outbox = []
  }

  _open() {
    this.swarm.on('connection', (conn) => this._onconnection(conn, 'internet'))
    this.discovery = this.swarm.join(this.topic, { client: true, server: true })
    this._startHunting()
    this._startBluetooth()
    // sin internet el announce nunca completa y BLE es el unico camino: no bloquear
    this.discovery.flushed().catch(() => {})
  }

  _startBluetooth() {
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
    if (this._hunt !== null) return
    this._hunt = setInterval(() => {
      if (this.peer !== null || this.closing !== null) return this._stopHunting()
      this.discovery?.refresh().catch(() => {})
    }, HUNT_INTERVAL)
    if (this._hunt.unref) this._hunt.unref()
  }

  _stopHunting() {
    if (this._hunt === null) return
    clearInterval(this._hunt)
    this._hunt = null
  }

  async _close() {
    this._stopHunting()
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

    this._attach(conn, via)
    if (reconnect) return

    // both ends need to agree on who moves first without a round trip
    const first = b4a.compare(conn.publicKey, conn.remotePublicKey) < 0
    this.emit('paired', { first, remoteKey: conn.remotePublicKey, via })
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

    pipe.on('data', (data) => {
      let msg = null
      try {
        msg = JSON.parse(b4a.toString(data))
      } catch {
        return
      }
      this.emit('message', msg)
    })

    conn.once('close', () => this._ondrop(conn))

    // su handler de close no dispara _ondrop porque this.peer ya apunta al nuevo
    if (old !== null) old.conn.destroy()

    while (this._outbox.length > 0) this.peer.pipe.write(this._outbox.shift())

    // cambio de transporte a mitad de partida (ej: wifi muerto → bluetooth)
    if (prevVia !== undefined && prevVia !== via) this.emit('via', via)
  }

  _ondrop(conn) {
    if (this.peer?.conn !== conn) return
    this._lostKey = conn.remotePublicKey
    this.peer = null
    this._startHunting()
    this._lostTimer = setTimeout(() => {
      this._lostTimer = null
      this._lostKey = null
      this._outbox = []
      this.emit('peer-lost')
    }, RECONNECT_GRACE)
    if (this._lostTimer.unref) this._lostTimer.unref()
  }

  _clearLossTimer() {
    if (this._lostTimer === null) return
    clearTimeout(this._lostTimer)
    this._lostTimer = null
  }

  send(msg) {
    const data = b4a.from(JSON.stringify(msg))
    if (this.peer !== null) {
      this.peer.pipe.write(data)
      return true
    }
    // sin socket pero dentro del margen de reconexion: encolar y entregar al volver
    if (this._lostKey !== null) {
      this._outbox.push(data)
      return true
    }
    return false
  }
}
