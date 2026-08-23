// Simulacion de snake, deterministica y sin nada de red.
//
// Todo el netcode se apoya en una sola propiedad: dado (semilla, arena, inputs),
// el estado en el tick N es identico en las dos maquinas. Por eso no se manda
// estado por la red, solo inputs — y por eso este archivo no sabe que existe un
// socket. Es tambien lo que hace que se pueda testear a fondo sin sockets, que
// es donde se atrapan los bugs de desincronizacion antes de que arruinen una
// partida en silencio.
//
// Las celdas van empaquetadas en un entero (y * ancho + x): copiar un cuerpo es
// un slice() de numeros en vez de clonar objetos, y eso importa porque el
// rollback re-simula decenas de ticks por paquete que llega tarde.

// 0 arriba · 1 derecha · 2 abajo · 3 izquierda
const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 }
]

const opposite = (a, b) => (a + 2) % 4 === b

// xorshift32: dos lineas, deterministico y con el estado en un solo uint32, que
// es lo que necesitamos para que entre en un snapshot sin costo
function nextRandom(rng) {
  let x = rng
  x ^= x << 13
  x >>>= 0
  x ^= x >>> 17
  x ^= x << 5
  x >>>= 0
  return x
}

class Sim {
  constructor(arena, seed) {
    this.arena = arena
    this.walls = new Set(arena.walls)
    this.state = this._initial(seed)
  }

  get width() {
    return this.arena.w
  }

  get height() {
    return this.arena.h
  }

  pack(x, y) {
    return y * this.arena.w + x
  }

  unpack(cell) {
    return { x: cell % this.arena.w, y: Math.floor(cell / this.arena.w) }
  }

  _initial(seed) {
    const { w, h } = this.arena
    const left = Math.max(2, Math.floor(w * 0.25))
    const right = Math.min(w - 3, Math.floor(w * 0.75))
    // en filas distintas a proposito: enfrentadas en la misma fila, quien no
    // hace nada choca de frente en diez ticks y no hay partida que mirar
    const topRow = Math.floor(h / 3)
    const bottomRow = Math.floor((2 * h) / 3)

    const state = {
      tick: 0,
      rng: seed >>> 0 || 1, // 0 es punto fijo de xorshift: seria una semilla muerta
      food: -1,
      snakes: [
        { body: [this.pack(left, topRow)], dir: 1, alive: true, grow: 2 },
        { body: [this.pack(right, bottomRow)], dir: 3, alive: true, grow: 2 }
      ],
      dead: null // {winner: 0|1|null} cuando termino
    }

    state.food = this._spawnFood(state)
    return state
  }

  // Recorre celdas al azar hasta encontrar una libre. Deterministico porque el
  // rng vive en el estado: las dos maquinas hacen exactamente las mismas
  // tiradas en el mismo orden.
  _spawnFood(state) {
    const total = this.arena.w * this.arena.h
    const occupied = new Set(this.walls)
    for (const s of state.snakes) for (const cell of s.body) occupied.add(cell)
    if (occupied.size >= total) return -1

    for (let attempt = 0; attempt < 200; attempt++) {
      state.rng = nextRandom(state.rng)
      const cell = state.rng % total
      if (!occupied.has(cell)) return cell
    }

    // fallback deterministico: la primera celda libre en orden. Con el tablero
    // casi lleno las tiradas al azar dejan de encontrar hueco, y adivinar
    // distinto en cada punta seria una desincronizacion.
    for (let cell = 0; cell < total; cell++) if (!occupied.has(cell)) return cell
    return -1
  }

  // Un cambio de direccion no se aplica al instante: se guarda y lo consume el
  // proximo tick. Si no, dos teclas en el mismo tick dejarian girar 180 grados
  // en el lugar y la serpiente se comeria a si misma.
  setDir(state, player, dir) {
    const snake = state.snakes[player]
    if (!snake.alive) return
    if (dir < 0 || dir > 3) return
    if (opposite(snake.dir, dir)) return // no se puede volver sobre uno mismo
    snake.dir = dir
  }

  step(state) {
    if (state.dead !== null) {
      state.tick += 1
      return state
    }

    const heads = []
    for (let i = 0; i < 2; i++) {
      const snake = state.snakes[i]
      if (!snake.alive) {
        heads.push(-1)
        continue
      }
      const { x, y } = this.unpack(snake.body[0])
      const d = DIRS[snake.dir]
      const nx = x + d.dx
      const ny = y + d.dy
      const out = nx < 0 || ny < 0 || nx >= this.arena.w || ny >= this.arena.h
      heads.push(out ? -1 : this.pack(nx, ny))
    }

    // Las colas se resuelven contra los cuerpos de ANTES de moverse, asi que
    // seguir la propia cola que se aparta cuenta como choque. Es lo que hace el
    // snake clasico y evita empates raros.
    const bodies = state.snakes.map((s) => new Set(s.body))

    const dies = [false, false]
    for (let i = 0; i < 2; i++) {
      const snake = state.snakes[i]
      if (!snake.alive) continue
      const head = heads[i]
      if (head === -1 || this.walls.has(head)) {
        dies[i] = true
        continue
      }
      if (bodies[0].has(head) || bodies[1].has(head)) dies[i] = true
    }

    // frente a frente en la misma celda: mueren los dos
    if (heads[0] !== -1 && heads[0] === heads[1]) {
      dies[0] = true
      dies[1] = true
    }

    for (let i = 0; i < 2; i++) {
      const snake = state.snakes[i]
      if (!snake.alive) continue

      if (dies[i]) {
        snake.alive = false
        continue
      }

      snake.body.unshift(heads[i])

      if (heads[i] === state.food) {
        snake.grow += 3
        state.food = -1 // se re-genera abajo, cuando los dos ya se movieron
      }

      if (snake.grow > 0) snake.grow -= 1
      else snake.body.pop()
    }

    if (state.food === -1 && (state.snakes[0].alive || state.snakes[1].alive)) {
      state.food = this._spawnFood(state)
    }

    const a = state.snakes[0].alive
    const b = state.snakes[1].alive
    if (!a || !b) state.dead = { winner: a === b ? null : a ? 0 : 1 }

    state.tick += 1
    return state
  }

  clone(state) {
    return {
      tick: state.tick,
      rng: state.rng,
      food: state.food,
      snakes: state.snakes.map((s) => ({
        body: s.body.slice(),
        dir: s.dir,
        alive: s.alive,
        grow: s.grow
      })),
      dead: state.dead === null ? null : { winner: state.dead.winner }
    }
  }

  // FNV-1a sobre todo lo que define la partida. Se intercambia cada tantos
  // ticks: si difiere, las simulaciones se separaron y hay que resincronizar.
  hash(state) {
    let h = 0x811c9dc5
    const mix = (n) => {
      h ^= n & 0xff
      h = (h * 0x01000193) >>> 0
      h ^= (n >>> 8) & 0xff
      h = (h * 0x01000193) >>> 0
    }
    mix(state.food + 1)
    mix(state.rng & 0xffff)
    mix((state.rng >>> 16) & 0xffff)
    for (const s of state.snakes) {
      mix(s.dir)
      mix(s.alive ? 1 : 0)
      mix(s.grow)
      mix(s.body.length)
      for (const cell of s.body) mix(cell)
    }
    return h >>> 0
  }
}

module.exports = { Sim, DIRS, opposite, nextRandom }
