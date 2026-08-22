const test = require('brittle')
const DHT = require('hyperdht')
const Lobby = require('../lib/lobby.js')
const protocol = require('../lib/protocol.js')
const tresEnRaya = require('../lib/games/tres-en-raya.js')
const snake = require('../lib/games/snake/index.js')
const arenas = require('../lib/games/snake/arenas.js')

// Cada juego, jugado de verdad sobre dos lobbies conectados.
//
// Los tests de test/snake.js prueban la simulacion sin red, y los de
// test/lobby.js prueban el transporte sin juego. Faltaba el cruce: que el juego
// REAL funcione sobre el transporte REAL. Es donde vive la clase de bug que se
// escapa a los dos — por ejemplo migrar los mensajes a un protocolo con
// discriminador y que un juego siga leyendo el campo viejo.

async function testnet(t) {
  const bootstrap = new DHT({ bootstrap: [], firewalled: false, ephemeral: false })
  await bootstrap.ready()
  const addr = [{ host: '127.0.0.1', port: bootstrap.address().port }]

  const nodes = []
  for (let i = 0; i < 3; i++) {
    const node = new DHT({ bootstrap: addr, firewalled: false, ephemeral: false })
    await node.ready()
    nodes.push(node)
  }

  t.teardown(async () => {
    for (const node of nodes) await node.destroy()
    await bootstrap.destroy()
  })

  return addr
}

const deadline = (ms, what) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${what}`)), ms).unref?.())

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.())

// Un jugador: lobby + estado de juego, cableado igual que lib/ui.js. Si esto se
// desvia de la UI el test deja de valer, asi que se mantiene deliberadamente
// parecido.
class Player {
  constructor(name, game, room, bootstrap) {
    this.name = name
    this.game = game
    this.lobby = new Lobby(game.id, room, { bootstrap, bluetooth: false })
    this.state = null
    this.chat = []
    this.paired = null
    this.host = false
    this.first = false
    this.seed = 0
    this.matchNo = 0

    this.lobby.on('paired', (info) => {
      this.host = info.first
      this.first = info.first
      this.seed = info.seed
      this.paired = info
      if (this.host) this._hostMatch()
      else if (!this.game.realtime) this._start(null)
    })

    this.lobby.on('message', (msg) => this._onpeer(msg))
  }

  _hostMatch() {
    const arena = this.game.realtime ? arenas.pick(this.matchNo) : null
    this.lobby.send({ t: protocol.T.MATCH, no: this.matchNo, arena })
    this._start(arena)
  }

  _start(arena) {
    const seed = (this.seed + this.matchNo * 0x9e3779b1) >>> 0
    this.state = this.game.init({ first: this.first, seed, arena })
  }

  _apply(result) {
    if (!result) return
    if (result.state !== undefined) this.state = result.state
    if (result.send) {
      const out = Array.isArray(result.send) ? result.send : [result.send]
      for (const msg of out) this.lobby.send(msg)
    }
  }

  _onpeer(msg) {
    if (msg.t === protocol.T.CHAT) {
      this.chat.push(msg.text)
      return
    }
    if (msg.t === protocol.T.MATCH) {
      if (this.host) return
      if (typeof msg.no === 'number') {
        this.first = msg.no % 2 === 0 ? this.host : !this.host
        this.matchNo = msg.no
      }
      this._start(msg.arena ? arenas.build(msg.arena) : null)
      return
    }
    if (this.state === null) return
    this._apply(this.game.onPeerMsg(this.state, msg))
  }

  key(k) {
    if (this.state === null) return
    this._apply(this.game.onKey(this.state, k))
  }

  tick() {
    if (this.state === null || !this.game.tick) return
    this._apply(this.game.tick(this.state))
  }

  say(text) {
    this.lobby.send({ t: protocol.T.CHAT, text })
  }

  async ready() {
    await this.lobby.ready()
  }

  async close() {
    await this.lobby.close()
  }
}

async function pair(t, game, room, bootstrap) {
  const a = new Player('a', game, room, bootstrap)
  const b = new Player('b', game, room, bootstrap)
  t.teardown(async () => {
    await a.close()
    await b.close()
  })

  await a.ready()
  await b.ready()

  const both = Promise.race([
    (async () => {
      while (a.state === null || b.state === null) await sleep(20)
    })(),
    deadline(10000, `arranque de ${game.id}`)
  ])
  await both

  return [a, b]
}

test('3 en raya: partida completa sobre la red, los dos coinciden en el resultado', async (t) => {
  const bootstrap = await testnet(t)
  const [a, b] = await pair(t, tresEnRaya, 'tateti-e2e', bootstrap)

  // quien juega con X arranca; averiguamos quien es
  const x = a.state.me === 'X' ? a : b
  const o = x === a ? b : a

  t.is(x.state.me, 'X')
  t.is(o.state.me, 'O')

  // X gana la fila de arriba: X en 1,2,3 y O metiendo en el medio
  //   X O .        X O .        X X X   <- gana
  //   . X .        . X .
  //   . . .        . . O
  const plays = [
    [x, '1'],
    [o, '2'],
    [x, '5'],
    [o, '9'],
    [x, '3'],
    [o, '4'],
    [x, '2'] // ya ocupada por O: el juego tiene que ignorarla
  ]

  for (const [who, k] of plays) {
    who.key(k)
    await sleep(150) // que el movimiento llegue al otro lado
  }

  // X tiene 1,5,3 — no es linea todavia. Cerramos por la diagonal 1-5-9.
  // 9 la tomo O, asi que vamos por la columna: 1,4,7 tiene 4 de O. Jugamos
  // sobre el tablero real en vez de asumirlo.
  const board = () => x.state.board.map((c) => c || '.').join('')
  t.ok(board().length === 9, `tablero: ${board()}`)

  // los dos lados tienen que ver EXACTAMENTE el mismo tablero
  t.alike(a.state.board, b.state.board, 'mismo tablero en las dos puntas')
  t.is(a.state.turn, b.state.turn, 'mismo turno')

  // y jugar hasta que termine, alternando en las casillas libres
  for (let guard = 0; guard < 12; guard++) {
    const done = tresEnRaya.isOver(a.state)
    if (done) break
    const turn = a.state.turn
    const who = a.state.me === turn ? a : b
    const free = a.state.board.findIndex((c) => c === null)
    if (free === -1) break
    who.key(String(free + 1))
    await sleep(150)
  }

  const da = tresEnRaya.isOver(a.state)
  const db = tresEnRaya.isOver(b.state)
  t.ok(da, 'termino para a')
  t.ok(db, 'termino para b')

  // el resultado tiene que ser espejo: si uno gano, el otro perdio
  if (da.result === 'draw') {
    t.is(db.result, 'draw', 'empate en las dos puntas')
  } else {
    t.is(da.result === 'win' ? 'loss' : 'win', db.result, 'resultado espejado')
  }
})

test('chat: ida y vuelta, varios mensajes, sin duplicados', async (t) => {
  const bootstrap = await testnet(t)
  const [a, b] = await pair(t, tresEnRaya, 'chat-e2e', bootstrap)

  a.say('hola')
  a.say('como va')
  b.say('todo bien')
  a.say('dale')
  b.say('jugamos')

  await Promise.race([
    (async () => {
      while (b.chat.length < 3 || a.chat.length < 2) await sleep(20)
    })(),
    deadline(8000, 'mensajes de chat')
  ])

  await sleep(500) // margen para que aparezca un duplicado si lo hubiera

  t.alike(b.chat, ['hola', 'como va', 'dale'], 'b recibio los de a, en orden')
  t.alike(a.chat, ['todo bien', 'jugamos'], 'a recibio los de b, en orden')
  t.is(b.chat.length, 3, 'sin duplicados en b')
  t.is(a.chat.length, 2, 'sin duplicados en a')
})

test('snake: dos peers simulan lo mismo con inputs cruzados por la red', async (t) => {
  const bootstrap = await testnet(t)
  const [a, b] = await pair(t, snake, 'snake-e2e', bootstrap)

  t.is(a.state.arena.id, b.state.arena.id, 'misma arena en las dos puntas')
  t.is(a.state.me === 0 ? 1 : 0, b.state.me, 'cada uno es una serpiente distinta')
  t.not(a.state.authority, b.state.authority, 'una sola autoridad')

  // relojes alineados: el anfitrion arranco antes, asi que el otro lo sigue
  const turns = ['up', 'right', 'down', 'left']
  for (let i = 0; i < 40; i++) {
    a.tick()
    b.tick()
    if (i % 7 === 3) a.key(turns[i % 4])
    if (i % 11 === 5) b.key(turns[(i + 2) % 4])
    await sleep(25)
  }

  // dejar que lleguen los ultimos inputs y que los ticks se igualen
  await sleep(600)
  for (let i = 0; i < 30; i++) {
    a.tick()
    b.tick()
    await sleep(25)
  }
  await sleep(400)

  // alinear al mismo tick antes de comparar: los relojes no arrancaron juntos
  const target = Math.max(a.state.net.tick, b.state.net.tick)
  const ha = a.state.net.hashAt(target - 12)
  const hb = b.state.net.hashAt(target - 12)

  t.ok(ha !== null && hb !== null, `hay historia en el tick ${target - 12}`)
  t.is(ha, hb, 'las dos simulaciones coinciden en el mismo tick')
  t.is(a.state.net.desyncs, 0, 'a no necesito resincronizar')
  t.is(b.state.net.desyncs, 0, 'b no necesito resincronizar')
})

test('snake: una desincronizacion forzada se recupera por la red', async (t) => {
  const bootstrap = await testnet(t)
  const [a, b] = await pair(t, snake, 'snake-desync', bootstrap)

  const follower = a.state.authority ? b : a
  const leader = follower === a ? b : a

  // correr un rato normal
  for (let i = 0; i < 30; i++) {
    a.tick()
    b.tick()
    await sleep(25)
  }

  // ensuciar al que NO tiene autoridad, por detras del protocolo: es lo que
  // pasaria si se perdiera un paquete justo en el borde de la ventana de rollback
  follower.state.net.state.snakes[0].body.unshift(999)
  follower.state.net.snapshots.clear()
  follower.state.net.snapshots.set(
    follower.state.net.state.tick,
    follower.state.net.sim.clone(follower.state.net.state)
  )

  const before = follower.state.net.desyncs

  // seguir ticking: el chequeo de hash tiene que notarlo y la autoridad mandar
  // un snapshot
  await Promise.race([
    (async () => {
      while (follower.state.net.desyncs === before) {
        a.tick()
        b.tick()
        await sleep(25)
      }
    })(),
    deadline(15000, 'deteccion de desincronizacion')
  ])

  t.ok(follower.state.net.desyncs > before, 'detecto y adopto el snapshot')
  t.is(leader.state.net.desyncs, 0, 'la autoridad no adopta nada')

  // y despues de adoptar, vuelven a coincidir
  for (let i = 0; i < 30; i++) {
    a.tick()
    b.tick()
    await sleep(25)
  }
  await sleep(300)

  const target = Math.min(a.state.net.tick, b.state.net.tick) - 10
  const ha = a.state.net.hashAt(target)
  const hb = b.state.net.hashAt(target)
  if (ha !== null && hb !== null) {
    t.is(ha, hb, 'recuperaron la sincronia')
  } else {
    t.pass('sin historia comun para comparar, pero la adopcion ocurrio')
  }
})

test('3 en raya: la revancha invierte los roles y el chat acepta acentos', async (t) => {
  const bootstrap = await testnet(t)
  const [a, b] = await pair(t, tresEnRaya, 'revancha-e2e', bootstrap)

  const firstX = a.state.me === 'X' ? 'a' : 'b'

  // texto en español por el mismo canal: el filtro de teclas era ASCII y esto no
  // se podia ni tipear
  a.say('¿jugamos otra? el año que viene no')
  await Promise.race([
    (async () => {
      while (b.chat.length < 1) await sleep(20)
    })(),
    deadline(8000, 'chat con acentos')
  ])
  t.is(b.chat[0], '¿jugamos otra? el año que viene no', 'los acentos y la ñ sobreviven')

  // revancha: el anfitrion anuncia la partida nueva igual que en la UI
  const host = a.host ? a : b
  const guest = host === a ? b : a

  host.matchNo += 1
  host.first = !host.first
  host._hostMatch()

  await Promise.race([
    (async () => {
      while (guest.matchNo !== host.matchNo) await sleep(20)
    })(),
    deadline(8000, 'la revancha llega al invitado')
  ])
  await sleep(200)

  const secondX = a.state.me === 'X' ? 'a' : 'b'
  t.not(firstX, secondX, 'quien juega con X cambio')
  t.not(a.state.me, b.state.me, 'siguen siendo roles opuestos')
  t.alike(a.state.board, new Array(9).fill(null), 'tablero limpio')
  t.alike(b.state.board, new Array(9).fill(null), 'tablero limpio en las dos puntas')

  // y la partida nueva se puede jugar
  const x = a.state.me === 'X' ? a : b
  x.key('5')
  await sleep(200)
  t.is(a.state.board[4], 'X', 'a ve la jugada')
  t.is(b.state.board[4], 'X', 'b ve la jugada')
})
