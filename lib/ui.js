const tty = require('bare-tty')
const games = require('./games/index.js')
const Lobby = require('./lobby.js')

const CLEAR = '\x1b[2J\x1b[H'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const CTRL_C = '\x03'

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

    this.stdin.setRawMode(true)
    this.stdin.on('data', (data) => this._onkey(data.toString()))
    this.stdout.on('resize', () => this.render())
  }

  // shown in every screen — this is where OTA events surface
  setStatus(text) {
    this.status = text
    this.render()
  }

  render() {
    const body =
      this.screen === 'menu'
        ? this._menu()
        : this.state === null
          ? this._waiting()
          : this.game.render(this.state)
    const foot = this.status ? `\n${DIM}${this.status}${RESET}\n` : '\n'
    this.stdout.write(CLEAR + body + foot + this._hints())
  }

  _menu() {
    const list = games.all
      .map(
        (g, i) =>
          `   ${BOLD}${i + 1}${RESET}  ${g.name}${g.realtime ? `  ${DIM}(tiempo real)${RESET}` : ''}`
      )
      .join('\n')

    return [
      '',
      `   ${BOLD}multigame-pears${RESET}  ${DIM}v${this.version}${RESET}`,
      `   ${DIM}juegos peer-to-peer, sin servidor${RESET}`,
      '',
      list,
      ''
    ].join('\n')
  }

  _waiting() {
    return ['', `   ${BOLD}${this.game.name}${RESET}`, '', '   Esperando rival…', ''].join('\n')
  }

  _hints() {
    if (this.screen === 'menu') {
      return `${DIM}   [1-${games.all.length}] jugar   ·   [q] salir${RESET}\n`
    }
    const over = this.state !== null && this.game.isOver(this.state)
    const keys = this.state === null || over ? '' : this.game.help + '   ·   '
    return `${DIM}   ${keys}[m] menú   ·   [q] salir${RESET}\n`
  }

  async _onkey(key) {
    if (key === CTRL_C || key === 'q') return this.emitClose()

    if (this.screen === 'menu') {
      const i = Number(key) - 1
      if (games.all[i]) await this._play(games.all[i])
      return
    }

    if (key === 'm') return this._toMenu()
    if (this.state === null) return

    const result = this.game.onKey(this.state, key)
    if (result === null) return
    this.state = result.state
    if (result.send) this.lobby.send(result.send)
    this.render()
  }

  async _play(game) {
    this.game = game
    this.screen = 'game'
    this.state = null
    this.setStatus('buscando rival…')

    this.lobby = new Lobby(game.id)

    this.lobby.on('paired', ({ first }) => {
      this.state = game.init({ first })
      this.setStatus('rival encontrado')
    })

    this.lobby.on('message', (msg) => {
      this.state = game.onPeerMsg(this.state, msg)
      this.render()
    })

    this.lobby.on('peer-lost', () => this.setStatus('el rival se fue — [m] para volver al menú'))

    await this.lobby.ready()
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
