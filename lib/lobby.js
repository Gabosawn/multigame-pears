const Hyperswarm = require('hyperswarm')
const FramedStream = require('framed-stream')
const ReadyResource = require('ready-resource')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

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
    this.peer = null
    this.discovery = null
    this._hunt = null
    this._lostKey = null
    this._lostTimer = null
    this._outbox = []
  }

  async _open() {
    this.swarm.on('connection', (conn) => this._onconnection(conn))
    this.discovery = this.swarm.join(this.topic, { client: true, server: true })
    this._startHunting()
    await this.discovery.flushed()
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
    await this.swarm.destroy()
  }

  _onconnection(conn) {
    conn.on('error', () => {})

    if (this.peer !== null) {
      // mismo rival con socket nuevo (dedup de hyperswarm): adoptarlo sin avisar
      if (b4a.equals(conn.remotePublicKey, this.peer.conn.remotePublicKey)) {
        return this._attach(conn)
      }
      // already playing — turn the newcomer away rather than juggling tables
      conn.destroy()
      return
    }

    // el rival que acabamos de perder volvio: partida intacta, ni paired ni peer-lost
    const reconnect = this._lostKey !== null && b4a.equals(conn.remotePublicKey, this._lostKey)

    this._attach(conn)
    if (reconnect) return

    // both ends need to agree on who moves first without a round trip
    const first = b4a.compare(conn.publicKey, conn.remotePublicKey) < 0
    this.emit('paired', { first, remoteKey: conn.remotePublicKey })
  }

  _attach(conn) {
    const old = this.peer
    const pipe = new FramedStream(conn)
    this.peer = { conn, pipe }
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
