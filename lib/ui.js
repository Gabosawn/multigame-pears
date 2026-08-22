const tty = require('bare-tty')
const games = require('./games/index.js')
const Lobby = require('./lobby.js')
const Screen = require('./screen.js')
const keys = require('./keys.js')
const protocol = require('./protocol.js')
const a = require('./ansi.js')

const ROOM_MAX = 24
const CHAT_MAX = 120
const CHAT_LINES = 2

// El renderer diferencial posiciona el cursor de forma absoluta, asi que si el
// contenido no entra la terminal scrollea y las lineas del frame anterior dejan
// de estar donde creemos: la pantalla se ensucia sola. Mejor decirlo.
const MIN_ROWS = 24
const MIN_COLS = 46

module.exports = class UI {
  constructor({ version }) {
    this.version = version
    this.stdin = new tty.ReadStream(0)
    this.screenOut = new Screen(1)

    this.screen = 'menu'
    this.status = ''
    this.game = null
    this.state = null
    this.lobby = null
    this.room = ''
    this.first = true
    this.seed = 0
    this.matchNo = 0
    this.via = null
    this.rtt = null
    this.peerVersion = null

    this.chat = []
    this.composing = false
    this.draft = ''

    this.loop = null

    this.stdin.setRawMode(true)
    this.stdin.on('data', (data) => this._oninput(data.toString()))
    this.screenOut.on('resize', () => {
      this.screenOut.invalidate()
      this.render()
    })
  }

  // visible en toda pantalla — es donde asoman los eventos de OTA
  setStatus(text) {
    this.status = text
    this.render()
  }

  render() {
    if (this.screenOut.rows < MIN_ROWS || this.screenOut.columns < MIN_COLS) {
      return this.screenOut.render(
        `\n  La terminal es chica para el tablero.\n` +
          `  ${a.dim(`Necesito ${MIN_COLS}x${MIN_ROWS}, tenes ${this.screenOut.columns}x${this.screenOut.rows}.`)}\n`
      )
    }

    let body
    if (this.screen === 'menu') body = this._menu()
    else if (this.screen === 'room') body = this._roomPrompt()
    else if (this.state === null) body = this._waiting()
    else body = this.game.render(this.state)

    const parts = [this._topBar(), body]
    if (this.screen === 'game') parts.push(this._chatPanel())
    parts.push(this._statusLine(), this._hints())

    this.screenOut.render(parts.join('\n'))
  }

  // Transporte y latencia siempre a la vista. Un numero medido convierte "esto
  // se siente lento" en un dato con el que se puede discutir — y sobre BLE el
  // RTT alto es fisica del radio, no un bug nuestro.
  _topBar() {
    const left = ` ${a.bold('multigame-pears')} ${a.dim('v' + this.version)}`
    if (this.screen !== 'game') return left

    const bits = []
    if (this.via !== null) {
      bits.push(this.via === 'bluetooth' ? a.cyan('ᛒ bluetooth') : a.green('⟡ internet'))
    }
    if (this.rtt !== null) bits.push(a.dim(`${this.rtt}ms`))
    if (this.peerVersion !== null && this.peerVersion !== this.version) {
      bits.push(a.yellow(`rival v${this.peerVersion}`))
    }
    if (this.state !== null && this.game.stats) {
      const s = this.game.stats(this.state)
      if (s.rollbacks > 0) bits.push(a.dim(`↺${s.rollbacks}`))
      if (s.desyncs > 0) bits.push(a.yellow(`⚠${s.desyncs}`))
    }

    const right = bits.length > 0 ? bits.join(a.dim(' · ')) : ''
    const room = a.dim(`sala: ${this.room}`)
    return `${left}   ${room}   ${right}`
  }

  _menu() {
    const list = games.all
      .map((g, i) => {
        const kind = g.realtime ? a.dim('tiempo real') : a.dim('por turnos')
        return `   ${a.bold(String(i + 1))}  ${g.name}  ${kind}`
      })
      .join('\n')

    return ['', `   ${a.dim('juegos peer-to-peer, sin servidor')}`, '', list, ''].join('\n')
  }

  _roomPrompt() {
    return [
      '',
      `   ${a.bold(this.game.name)}`,
      '',
      '   Nombre de la sala:',
      `   ${a.bold(this.room)}█`,
      '',
      `   ${a.dim('Quien quiera jugar con vos tiene que escribir el mismo nombre.')}`,
      ''
    ].join('\n')
  }

  _waiting() {
    return [
      '',
      `   ${a.bold(this.game.name)}`,
      '',
      '   Esperando rival…',
      '',
      `   ${a.dim(`Deci a la otra persona que entre a la sala "${this.room}".`)}`,
      ''
    ].join('\n')
  }

  _chatPanel() {
    const lines = []
    const recent = this.chat.slice(-CHAT_LINES)
    for (let i = 0; i < CHAT_LINES; i++) {
      const msg = recent[i - (CHAT_LINES - recent.length)]
      if (msg === undefined) {
        lines.push('')
        continue
      }
      const who = msg.mine ? a.cyan('vos') : a.magenta('rival')
      lines.push(`  ${who} ${a.dim('│')} ${msg.text}`)
    }
    if (this.composing) lines.push(`  ${a.bold('>')} ${this.draft}█`)
    else lines.push('')
    return lines.join('\n')
  }

  _statusLine() {
    const extra = this.state !== null && this.state.status ? this.state.status : null
    const text = extra || this.status
    return text ? `  ${a.dim(text)}` : ''
  }

  _hints() {
    if (this.screen === 'menu') {
      return a.dim(`  [1-${games.all.length}] jugar   ·   [q] salir`)
    }
    if (this.screen === 'room') {
      return a.dim('  [enter] entrar   ·   [esc] volver   ·   [ctrl-c] salir')
    }
    if (this.composing) {
      return a.dim('  [enter] enviar   ·   [esc] cancelar')
    }
    const over = this.state !== null && this.game.isOver(this.state)
    let extra = ''
    if (over) extra = '[r] revancha   ·   '
    else if (this.state !== null) extra = this.game.help + '   ·   '
    return a.dim(`  ${extra}[t] chat   ·   [m] menú   ·   [q] salir`)
  }

  _oninput(chunk) {
    for (const key of keys.decode(chunk)) this._onkey(key)
  }

  _onkey(key) {
    if (key === 'ctrl-c') return this.emitClose()

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
    if (key === 'escape') {
      this.screen = 'menu'
      this.game = null
      return this.setStatus('')
    }
    if (key === 'enter') {
      if (this.room.length === 0) return
      return this._play()
    }
    if (key === 'backspace') {
      this.room = this.room.slice(0, -1)
      return this.render()
    }
    // solo texto imprimible, para que el nombre viaje igual en las dos puntas
    if (keys.printable(key) && this.room.length < ROOM_MAX) {
      this.room += key
      this.render()
    }
  }

  _gameKey(key) {
    if (this.composing) return this._composeKey(key)

    if (key === 'q') return this.emitClose()
    if (key === 'm') return this._toMenu()
    if (key === 't' && this.lobby !== null) {
      this.composing = true
      this.draft = ''
      return this.render()
    }
    if (this.state === null) return

    if (key === 'r' && this.game.isOver(this.state)) {
      this.lobby.send({ t: protocol.T.REMATCH })
      return this._rematch()
    }

    const result = this.game.onKey(this.state, key)
    if (result === null) return
    this._apply(result)
  }

  _composeKey(key) {
    if (key === 'escape') {
      this.composing = false
      this.draft = ''
      return this.render()
    }
    if (key === 'enter') {
      const text = this.draft.trim()
      this.composing = false
      this.draft = ''
      if (text.length > 0) {
        this.lobby.send({ t: protocol.T.CHAT, text })
        this.chat.push({ mine: true, text })
      }
      return this.render()
    }
    if (key === 'backspace') {
      this.draft = this.draft.slice(0, -1)
      return this.render()
    }
    if (keys.printable(key) && this.draft.length < CHAT_MAX) {
      this.draft += key
      this.render()
    }
  }

  // los juegos devuelven {state, send} — send puede ser uno o varios mensajes
  _apply(result) {
    if (result === null || result === undefined) return
    if (result.state !== undefined) this.state = result.state
    if (result.send) {
      const out = Array.isArray(result.send) ? result.send : [result.send]
      for (const msg of out) this.lobby?.send(msg)
    }
    this.render()
  }

  // los dos lados invierten quien empieza, asi los roles siguen siendo opuestos
  _rematch() {
    this.first = !this.first
    this.matchNo += 1
    this._startMatch()
    this.setStatus('revancha')
  }

  _startMatch() {
    // semilla distinta por partida, derivada igual en las dos puntas: si no, la
    // comida caeria en los mismos lugares en cada revancha
    const seed = (this.seed + this.matchNo * 0x9e3779b1) >>> 0
    this.state = this.game.init({ first: this.first, seed })
    this._stopLoop()
    if (this.game.realtime) this._startLoop()
  }

  _startLoop() {
    const tickMs = this.state.tickMs || 66
    this.loop = setInterval(() => {
      if (this.state === null || this.game === null) return
      this._apply(this.game.tick(this.state))
    }, tickMs)
    if (this.loop.unref) this.loop.unref()
  }

  _stopLoop() {
    if (this.loop === null) return
    clearInterval(this.loop)
    this.loop = null
  }

  async _play() {
    this.screen = 'game'
    this.state = null
    this.chat = []
    this.via = null
    this.rtt = null
    this.peerVersion = null
    this.matchNo = 0
    this.setStatus('buscando rival…')

    this.lobby = new Lobby(this.game.id, this.room)

    this.lobby.on('paired', ({ first, seed, via }) => {
      this.first = first
      this.seed = seed
      this.via = via
      this._startMatch()
      this.lobby.send({ t: protocol.T.HELLO, v: this.version })
      this.setStatus(
        via === 'bluetooth' ? 'rival encontrado por bluetooth ᛒ' : 'rival encontrado por internet'
      )
    })

    this.lobby.on('via', (via) => {
      this.via = via
      this.setStatus(via === 'bluetooth' ? 'conexión por bluetooth ᛒ' : 'conexión por internet')
    })

    this.lobby.on('rtt', (rtt) => {
      this.rtt = rtt
      this.render()
    })

    this.lobby.on('message', (msg) => this._onpeer(msg))

    this.lobby.on('reconnecting', (left) => {
      this.setStatus(`se cortó — reconectando… ${left}s`)
    })

    this.lobby.on('peer-lost', () => {
      this._stopLoop()
      this.state = null
      this.via = null
      this.rtt = null
      this.setStatus('el rival se fue — esperando a otro…')
    })

    await this.lobby.ready()
    if (this.lobby !== null && this.lobby.bt !== null && this.state === null) {
      this.setStatus('buscando rival… (internet + bluetooth ᛒ)')
    }
  }

  _onpeer(msg) {
    if (msg.t === protocol.T.HELLO) {
      this.peerVersion = typeof msg.v === 'string' ? msg.v : null
      if (this.peerVersion !== null && this.peerVersion !== this.version) {
        this.setStatus(`el rival tiene v${this.peerVersion} — el OTA la va a traer`)
      }
      return
    }

    if (msg.t === protocol.T.CHAT) {
      if (typeof msg.text !== 'string') return
      this.chat.push({ mine: false, text: msg.text.slice(0, CHAT_MAX) })
      return this.render()
    }

    if (msg.t === protocol.T.REMATCH) return this._rematch()

    if (this.state === null) return
    this._apply(this.game.onPeerMsg(this.state, msg))
  }

  async _toMenu() {
    this._stopLoop()
    if (this.lobby) {
      const lobby = this.lobby
      this.lobby = null
      await lobby.close()
    }
    this.screen = 'menu'
    this.game = null
    this.state = null
    this.room = ''
    this.chat = []
    this.composing = false
    this.setStatus('')
  }

  emitClose() {
    if (this.onclose) this.onclose()
  }

  async close() {
    this._stopLoop()
    this.stdin.setRawMode(false)
    this.stdin.destroy()
    if (this.lobby) await this.lobby.close()
    this.screenOut.close()
  }
}
