const tty = require('bare-tty')
const games = require('./games/index.js')
const Lobby = require('./lobby.js')

const CLEAR = '\x1b[2J\x1b[H'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const CTRL_C = '\x03'
const ESCAPE = '\x1b'
const ENTER = '\r'
const NEWLINE = '\n'
const BACKSPACE = '\x7f'

const ROOM_MAX = 24

module.exports = class UI {
  constructor({ version }) {
    this.version = version
    this.stdin = new tty.ReadStream(0)
    this.stdout = new tty.WriteStream(1)

    this.screen = 'menu'
    this.status = ''
    this.game = null
    this.state = null
    this.lobby = null
    this.room = ''
    this.first = true

    this.stdin.setRawMode(true)
    this.stdin.on('data', (data) => this._oninput(data.toString()))
    this.stdout.on('resize', () => this.render())
  }

  // visible en toda pantalla — es donde asoman los eventos de OTA
  setStatus(text) {
    this.status = text
    this.render()
  }

  render() {
    let body
    if (this.screen === 'menu') body = this._menu()
    else if (this.screen === 'room') body = this._roomPrompt()
    else if (this.state === null) body = this._waiting()
    else body = this.game.render(this.state)

    const foot = this.status ? `\n${DIM}${this.status}${RESET}\n` : '\n'
    this.stdout.write(CLEAR + body + foot + this._hints())
  }

  _menu() {
    const list = games.all.map((g, i) => `   ${BOLD}${i + 1}${RESET}  ${g.name}`).join('\n')

    return [
      '',
      `   ${BOLD}multigame-pears${RESET}  ${DIM}v${this.version}${RESET}`,
      `   ${DIM}juegos peer-to-peer, sin servidor${RESET}`,
      '',
      list,
      ''
    ].join('\n')
  }

  _roomPrompt() {
    return [
      '',
      `   ${BOLD}${this.game.name}${RESET}`,
      '',
      '   Nombre de la sala:',
      `   ${BOLD}${this.room}${RESET}█`,
      '',
      `   ${DIM}Quien quiera jugar con vos tiene que escribir el mismo nombre.${RESET}`,
      ''
    ].join('\n')
  }

  _waiting() {
    return [
      '',
      `   ${BOLD}${this.game.name}${RESET}   ${DIM}sala: ${this.room}${RESET}`,
      '',
      '   Esperando rival…',
      '',
      `   ${DIM}Deci a la otra persona que entre a la sala "${this.room}".${RESET}`,
      ''
    ].join('\n')
  }

  _hints() {
    if (this.screen === 'menu') {
      return `${DIM}   [1-${games.all.length}] jugar   ·   [q] salir${RESET}\n`
    }
    if (this.screen === 'room') {
      return `${DIM}   [enter] entrar   ·   [esc] volver   ·   [ctrl-c] salir${RESET}\n`
    }
    const over = this.state !== null && this.game.isOver(this.state)
    let keys = ''
    if (over) keys = '[r] revancha   ·   '
    else if (this.state !== null) keys = this.game.help + '   ·   '
    return `${DIM}   ${keys}[m] menú   ·   [q] salir${RESET}\n`
  }

  // un chunk puede traer varias teclas (tipeo rapido, pegado)
  _oninput(chunk) {
    // las secuencias de escape (flechas, F1…) llegan enteras en un chunk
    if (chunk.length > 1 && chunk[0] === ESCAPE) return
    for (const key of chunk) this._onkey(key)
  }

  _onkey(key) {
    if (key === CTRL_C) return this.emitClose()

    if (this.screen === 'menu') return this._menuKey(key)
    if (this.screen === 'room') return this._roomKey(key)
    return this._gameKey(key)
  }

  _menuKey(key) {
    if (key === 'q') return this.emitClose()
    const i = Number(key) - 1
    if (!games.all[i]) return
    this.game = games.all[i]
    this.room = ''
    this.screen = 'room'
    this.render()
  }

  _roomKey(key) {
    if (key === ESCAPE) {
      this.screen = 'menu'
      this.game = null
      return this.setStatus('')
    }
    if (key === ENTER || key === NEWLINE) {
      if (this.room.length === 0) return
      return this._play()
    }
    if (key === BACKSPACE) {
      this.room = this.room.slice(0, -1)
      return this.render()
    }
    // solo texto imprimible, para que el nombre viaje igual en las dos puntas
    if (key.length === 1 && key >= ' ' && key <= '~' && this.room.length < ROOM_MAX) {
      this.room += key
      this.render()
    }
  }

  _gameKey(key) {
    if (key === 'q') return this.emitClose()
    if (key === 'm') return this._toMenu()
    if (this.state === null) return

    if (key === 'r' && this.game.isOver(this.state)) {
      this.lobby.send({ rematch: true })
      return this._rematch()
    }

    const result = this.game.onKey(this.state, key)
    if (result === null) return
    this.state = result.state
    if (result.send) this.lobby.send(result.send)
    this.render()
  }

  // los dos lados invierten quien empieza, asi los roles siguen siendo opuestos
  _rematch() {
    this.first = !this.first
    this.state = this.game.init({ first: this.first })
    this.setStatus('revancha')
  }

  async _play() {
    this.screen = 'game'
    this.state = null
    this.setStatus('buscando rival…')

    this.lobby = new Lobby(this.game.id, this.room)

    this.lobby.on('paired', ({ first, via }) => {
      this.first = first
      this.state = this.game.init({ first })
      this.setStatus(
        via === 'bluetooth' ? 'rival encontrado por bluetooth ᛒ' : 'rival encontrado por internet'
      )
    })

    this.lobby.on('via', (via) => {
      this.setStatus(via === 'bluetooth' ? 'conexión por bluetooth ᛒ' : 'conexión por internet')
    })

    this.lobby.on('message', (msg) => {
      if (msg && msg.rematch === true) return this._rematch()
      if (this.state === null) return
      this.state = this.game.onPeerMsg(this.state, msg)
      this.render()
    })

    this.lobby.on('peer-lost', () => {
      this.state = null
      this.setStatus('el rival se fue — esperando a otro…')
    })

    await this.lobby.ready()
    if (this.lobby !== null && this.lobby.bt !== null && this.state === null) {
      this.setStatus('buscando rival… (internet + bluetooth ᛒ)')
    }
  }

  async _toMenu() {
    if (this.lobby) {
      const lobby = this.lobby
      this.lobby = null
      await lobby.close()
    }
    this.screen = 'menu'
    this.game = null
    this.state = null
    this.room = ''
    this.setStatus('')
  }

  emitClose() {
    if (this.onclose) this.onclose()
  }

  async close() {
    this.stdin.setRawMode(false)
    this.stdin.destroy()
    if (this.lobby) await this.lobby.close()
    this.stdout.write(CLEAR)
  }
}
