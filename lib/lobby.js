const Hyperswarm = require('hyperswarm')
const FramedStream = require('framed-stream')
const ReadyResource = require('ready-resource')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const NAMESPACE = 'multigame-pears/v1/'

// hyperswarm solo repite la busqueda cada 10 min. En un lobby el rival entra
// segundos despues, asi que mientras no haya con quien jugar buscamos seguido.
const HUNT_INTERVAL = 3000

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
    this.peer?.conn.destroy()
    this.peer = null
    await this.swarm.destroy()
  }

  _onconnection(conn) {
    conn.on('error', () => {})

    // already playing — turn the newcomer away rather than juggling tables
    if (this.peer !== null) {
      conn.destroy()
      return
    }

    const pipe = new FramedStream(conn)
    this.peer = { conn, pipe }

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

    conn.once('close', () => {
      if (this.peer?.conn !== conn) return
      this.peer = null
      this._startHunting()
      this.emit('peer-lost')
    })

    // both ends need to agree on who moves first without a round trip
    const first = b4a.compare(conn.publicKey, conn.remotePublicKey) < 0

    this._stopHunting()
    this.emit('paired', { first, remoteKey: conn.remotePublicKey })
  }

  send(msg) {
    if (this.peer === null) return false
    this.peer.pipe.write(b4a.from(JSON.stringify(msg)))
    return true
  }
}
