const tty = require('bare-tty')
const games = require('./games/index.js')
const arenas = require('./games/snake/arenas.js')
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
  constructor({ version, content = null, prefs = null }) {
    this.version = version
    this.content = content
    this.prefs = prefs
    this.stdin = new tty.ReadStream(0)
    this.screenOut = new Screen(1)

    this.screen = 'menu'
    this.status = ''
    this.game = null
    this.state = null
    this.lobby = null
    this.room = ''

    // `host` es estable desde el emparejamiento y decide la arena de cada
    // partida; `first` alterna en cada revancha para que los roles se inviertan.
    // Son cosas distintas: si la eleccion de arena alternara, los dos lados
    // podrian anunciar arenas distintas en la misma revancha.
    this.host = true
    this.first = true
    this.seed = 0
    this.matchNo = 0

    this.via = null
    this.rtt = null
    this.peerVersion = null

    this.chat = []
    this.composing = false
    this.draft = ''

    this.updateState = null // texto del updater de Pear
    this.loop = null

    // novedades: si la version cambio desde la ultima corrida, un OTA acaba de
    // aterrizar y hay algo que contar
    this.news = this._pendingNews()

    if (this.content !== null) {
      this.content.onchange = (added) => this._oncontent(added)
    }

    this.stdin.setRawMode(true)
    this.stdin.on('data', (data) => this._oninput(data.toString()))
    this.screenOut.on('resize', () => {
      this.screenOut.invalidate()
      this.render()
    })
  }

  _pendingNews() {
    if (this.prefs === null) return null
    const seen = this.prefs.get('lastVersion')
    if (seen === this.version) return null
    this.prefs.set('lastVersion', this.version)
    if (seen === null) return null // primera instalacion: no hay "novedad"
    return { from: seen, to: this.version }
  }

  // visible en toda pantalla — es donde asoman los eventos de OTA
  setStatus(text) {
    this.status = text
    this.render()
  }

  setUpdateState(text) {
    this.updateState = text
    this.render()
  }

  render() {
    if (this.screenOut.rows < MIN_ROWS || this.screenOut.columns < MIN_COLS) {
      const need = a.dim(
        `Necesito ${MIN_COLS}x${MIN_ROWS}, tenes ${this.screenOut.columns}x${this.screenOut.rows}.`
      )
      return this.screenOut.render(`\n  La terminal es chica para el tablero.\n  ${need}\n`)
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
    return `${left}   ${a.dim(`sala: ${this.room}`)}   ${right}`
  }

  _menu() {
    const list = games.all
      .map((g, i) => {
        const kind = g.realtime ? a.dim('tiempo real') : a.dim('por turnos')
        return `   ${a.bold(String(i + 1))}  ${g.name}  ${kind}`
      })
      .join('\n')

    const lines = ['', `   ${a.dim('juegos peer-to-peer, sin servidor')}`, '', list, '']

    if (this.news !== null) {
      lines.push(`   ${a.yellow('✦')} Se actualizó sola: v${this.news.from} → v${this.news.to}`)
      for (const note of this._newsNotes()) lines.push(`     ${a.dim('·')} ${note}`)
      lines.push('')
    }

    const extra = this.content === null ? [] : this.content.arenas()
    if (extra.length > 0) {
      const names = extra.map((x) => x.name).join(', ')
      lines.push(`   ${a.cyan('✦')} Arenas que llegaron por la red: ${a.dim(names)}`)
      lines.push('')
    }

    return lines.join('\n')
  }

  _newsNotes() {
    if (this.content === null) return []
    const out = []
    for (const item of this.content.news()) {
      if (item.version !== this.version) continue
      for (const note of item.notes || []) out.push(note)
    }
    return out.slice(0, 3)
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
    lines.push(this.composing ? `  ${a.bold('>')} ${this.draft}█` : '')
    return lines.join('\n')
  }

  _statusLine() {
    const fromGame = this.state !== null && this.state.status ? this.state.status : null
    const text = this.updateState || fromGame || this.status
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
    this.news = null // ya las viste
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

    this._apply(this.game.onKey(this.state, key))
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

  _rematch() {
    // los roles se invierten, pero el anfitrion sigue siendo el mismo
    this.first = !this.first
    this.matchNo += 1
    if (this.host) this._hostMatch()
    else this.setStatus('revancha — esperando la arena del anfitrion…')
  }

  // El anfitrion elige la arena y la manda ENTERA. Asi el rival puede jugar en
  // una arena que acaba de llegarle por la red (o que todavia no tiene), sin
  // negociar quien tiene que.
  _hostMatch() {
    const extra = this.content === null ? [] : this.content.arenas()

    // lo que acaba de llegar por la red se estrena ya; si no hay nada nuevo, se
    // rota entre las que haya
    let arena = null
    if (this.game.realtime) {
      arena =
        (this.content !== null && this.content.freshArena()) || arenas.pick(this.matchNo, extra)
    }

    this.lobby?.send({ t: protocol.T.MATCH, no: this.matchNo, arena: arena ? arena : null })
    this._startMatch(arena)
  }

  _startMatch(arena) {
    // semilla distinta por partida, derivada igual en las dos puntas: si no, la
    // comida caeria en los mismos lugares en cada revancha
    const seed = (this.seed + this.matchNo * 0x9e3779b1) >>> 0
    this.state = this.game.init({ first: this.first, seed, arena })
    this._stopLoop()
    if (this.game.realtime) this._startLoop()
    this.render()
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
      this.host = first
      this.first = first
      this.seed = seed
      this.via = via
      this.matchNo = 0

      this.lobby.send({ t: protocol.T.HELLO, v: this.version })
      if (this.content !== null && this.content.enabled) {
        this.lobby.send({ t: protocol.T.CONTENT_HAVE, ids: this.content.ids() })
      }

      this.setStatus(
        via === 'bluetooth' ? 'rival encontrado por bluetooth ᛒ' : 'rival encontrado por internet'
      )
      if (this.host) this._hostMatch()
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
    switch (msg.t) {
      case protocol.T.HELLO:
        this.peerVersion = typeof msg.v === 'string' ? msg.v : null
        if (this.peerVersion !== null && this.peerVersion !== this.version) {
          this.setStatus(`el rival tiene v${this.peerVersion} — el OTA la va a traer`)
        }
        return

      case protocol.T.CHAT:
        if (typeof msg.text !== 'string') return
        this.chat.push({ mine: false, text: msg.text.slice(0, CHAT_MAX) })
        return this.render()

      case protocol.T.REMATCH:
        // si los dos apretan [r] casi a la vez, el anfitrion recibiria el
        // REMATCH del otro despues de haber arrancado ya la revancha y montaria
        // una segunda partida encima. Solo cuenta si la actual sigue terminada.
        if (this.state !== null && !this.game.isOver(this.state)) return
        return this._rematch()

      case protocol.T.MATCH: {
        if (this.host) return // el anfitrion no recibe arenas, las manda
        if (typeof msg.no === 'number') {
          this.first = msg.no % 2 === 0 ? this.host : !this.host
          this.matchNo = msg.no
        }
        let arena = null
        if (msg.arena) {
          try {
            arena = arenas.build(msg.arena)
          } catch {
            return this.setStatus('el anfitrion mandó una arena que no entiendo')
          }
        }
        return this._startMatch(arena)
      }

      case protocol.T.CONTENT_HAVE: {
        if (this.content === null || !this.content.enabled) return
        const give = this.content.missing(msg.ids)
        if (give.length > 0) this.lobby?.send({ t: protocol.T.CONTENT_GIVE, records: give })
        return
      }

      case protocol.T.CONTENT_GIVE:
        if (this.content === null || !this.content.enabled) return
        this.content.merge(msg.records)
        return

      default:
        if (this.state === null) return
        this._apply(this.game.onPeerMsg(this.state, msg))
    }
  }

  _oncontent(added) {
    const arenaNames = this.content
      .arenas()
      .map((x) => x.name)
      .slice(-1)
    const what = arenaNames.length > 0 ? `: ${arenaNames[0]}` : ''
    this.setStatus(`✦ llegó contenido nuevo${what} — [r] para estrenarlo`)
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
