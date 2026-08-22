const { Sim } = require('./sim.js')
const Netcode = require('./netcode.js')
const arenas = require('./arenas.js')
const protocol = require('../../protocol.js')
const a = require('../../ansi.js')

// Cada cuantos ticks se intercambia el hash del estado. Sin esto, un paquete
// perdido en el borde de la ventana de rollback separa las dos partidas y nadie
// se entera: uno ve que gano y el otro que perdio.
const SYNC_EVERY = 20

// Los ticks del sync se comparan contra la historia del rival, y sus relojes no
// arrancan exactamente juntos. Miramos un tick ya viejo para que las dos puntas
// lo tengan seguro en su historial.
const SYNC_LAG = 8

const EMPTY = ' '
const FOOD = a.yellow('◆')
const WALL = a.dim('▒')
const BODY = [a.cyan('●'), a.magenta('●')]
const HEAD = [a.brightCyan('◉'), a.brightMagenta('◉')]

module.exports = {
  id: 'snake',
  name: 'Snake (duelo)',
  players: 2,
  realtime: true,
  help: 'Flechas o WASD para girar',

  // `first` decide quien es la serpiente 0, igual que el turno del 3 en raya.
  // `seed` viene del lobby, derivado de las dos pubkeys: las dos maquinas
  // calculan la misma sin intercambiar nada.
  init({ first, seed, arenaId, extraArenas }) {
    const arena = arenas.get(arenaId || 'vacio', extraArenas || [])
    const sim = new Sim(arena, seed)

    return {
      arena,
      sim,
      net: new Netcode(sim, { player: first ? 0 : 1 }),
      me: first ? 0 : 1,
      authority: first, // quien manda el snapshot cuando hay desincronizacion
      seed,
      start: Date.now(),
      tickMs: Math.round(1000 / arena.tickRate),
      lastSyncSent: -1,
      status: null // texto efimero: "resincronizado", etc
    }
  },

  // Llamado por el loop de la UI. El tick objetivo sale del reloj, no de contar
  // cuantas veces corrio el intervalo: si un frame se atrasa, el siguiente
  // recupera en vez de arrastrar el desfase toda la partida.
  tick(state) {
    const target = Math.floor((Date.now() - state.start) / state.tickMs)
    state.net.advanceTo(target)

    const syncAt = state.net.tick - SYNC_LAG
    if (syncAt > 0 && syncAt % SYNC_EVERY === 0 && syncAt > state.lastSyncSent) {
      state.lastSyncSent = syncAt
      const hash = state.net.hashAt(syncAt)
      if (hash !== null) {
        return { state, send: { t: protocol.T.SYNC, tick: syncAt, hash } }
      }
    }

    return { state }
  },

  onKey(state, key) {
    const dir = DIR_KEYS[key]
    if (dir === undefined) return null

    const msg = state.net.localInput(dir)
    if (msg === null) return { state } // sin cambio: no gastar un paquete

    return { state, send: { t: protocol.T.INPUT, tick: msg.tick, dir: msg.dir } }
  },

  onPeerMsg(state, msg) {
    if (msg.t === protocol.T.INPUT) {
      state.net.remoteInput(msg.tick, msg.dir)
      return { state }
    }

    if (msg.t === protocol.T.SYNC) {
      const mine = state.net.hashAt(msg.tick)
      if (mine === null || mine === msg.hash) return { state }

      // Las simulaciones se separaron. El que tiene autoridad manda su estado y
      // el otro lo adopta; asi no hay que negociar nada ni arriesgar que los
      // dos se "arreglen" hacia estados distintos.
      if (state.authority) {
        state.status = 'resincronizando al rival'
        return { state, send: { t: protocol.T.STATE, snap: state.net.serialize() } }
      }
      return { state }
    }

    if (msg.t === protocol.T.STATE) {
      if (state.authority) return { state } // la autoridad no adopta
      if (!msg.snap || !Array.isArray(msg.snap.snakes)) return { state }
      state.net.adopt(msg.snap)
      // el reloj tiene que quedar consistente con el tick adoptado, o el
      // proximo advanceTo re-simularia lo que acabamos de recibir
      state.start = Date.now() - msg.snap.tick * state.tickMs
      state.status = 'resincronizado'
      return { state }
    }

    return { state }
  },

  isOver(state) {
    const dead = state.net.state.dead
    if (dead === null) return null
    if (dead.winner === null) return { result: 'draw' }
    return { result: dead.winner === state.me ? 'win' : 'loss' }
  },

  render(state) {
    const { arena } = state
    const s = state.net.state
    const grid = new Array(arena.w * arena.h).fill(EMPTY)

    for (const cell of arena.walls) grid[cell] = WALL
    if (s.food >= 0) grid[s.food] = FOOD

    for (let p = 0; p < 2; p++) {
      const snake = s.snakes[p]
      for (let i = snake.body.length - 1; i >= 0; i--) {
        const cell = snake.body[i]
        if (cell < 0 || cell >= grid.length) continue
        grid[cell] = i === 0 ? HEAD[p] : BODY[p]
      }
    }

    const rows = []
    for (let y = 0; y < arena.h; y++) {
      rows.push(
        '  ' + a.dim('│') + grid.slice(y * arena.w, (y + 1) * arena.w).join('') + a.dim('│')
      )
    }

    const edge = '  ' + a.dim('┌' + '─'.repeat(arena.w) + '┐')
    const foot = '  ' + a.dim('└' + '─'.repeat(arena.w) + '┘')

    const mine = s.snakes[state.me]
    const theirs = s.snakes[state.me === 0 ? 1 : 0]
    const badge = state.me === 0 ? a.brightCyan('◉ vos') : a.brightMagenta('◉ vos')
    const rival = state.me === 0 ? a.brightMagenta('◉ rival') : a.brightCyan('◉ rival')

    const scoreline =
      `  ${badge} ${mine.body.length}` +
      a.dim('   ·   ') +
      `${rival} ${theirs.body.length}` +
      a.dim(`   ·   ${arena.name}`)

    // 19 filas exactas (marcador + borde + h + borde): el layout de la UI
    // cuenta con eso para entrar en una terminal de 24
    return [scoreline, edge, ...rows, foot].join('\n')
  },

  // dato de diagnostico para la barra de estado: cuanto trabajo real hizo el
  // netcode. Un numero de rollbacks alto con cero desyncs es exactamente lo que
  // se espera sobre un enlace lento — el sistema funcionando, no fallando.
  stats(state) {
    return { rollbacks: state.net.rollbacks, desyncs: state.net.desyncs, tick: state.net.tick }
  }
}

const DIR_KEYS = {
  up: 0,
  right: 1,
  down: 2,
  left: 3,
  w: 0,
  d: 1,
  s: 2,
  a: 3,
  W: 0,
  D: 1,
  S: 2,
  A: 3
}
