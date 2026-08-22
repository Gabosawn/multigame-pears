const test = require('brittle')
const { Sim } = require('../lib/games/snake/sim.js')
const Netcode = require('../lib/games/snake/netcode.js')
const arenas = require('../lib/games/snake/arenas.js')

const ARENA = arenas.get('vacio')
const SEED = 0x1234abcd

const make = (player) => new Netcode(new Sim(ARENA, SEED), { player })

// una tanda de inputs pseudo-aleatoria pero fija, para que el test sea repetible
function script(n, salt) {
  const out = []
  let x = salt
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    if (x % 5 === 0) out.push({ tick: i, player: x % 2, dir: (x >>> 8) % 4 })
  }
  return out
}

test('snake: la simulacion es deterministica', (t) => {
  const a = new Sim(ARENA, SEED)
  const b = new Sim(ARENA, SEED)

  for (let i = 0; i < 500; i++) {
    a.setDir(a.state, 0, i % 4)
    b.setDir(b.state, 0, i % 4)
    a.step(a.state)
    b.step(b.state)
  }

  t.is(a.hash(a.state), b.hash(b.state), 'mismos inputs, mismo estado')
})

test('snake: semillas distintas divergen (el hash sirve de algo)', (t) => {
  const a = new Sim(ARENA, SEED)
  const b = new Sim(ARENA, SEED + 1)
  for (let i = 0; i < 40; i++) {
    a.step(a.state)
    b.step(b.state)
  }
  t.not(a.hash(a.state), b.hash(b.state), 'la comida cae en otro lado')
})

test('snake: las dos puntas convergen con inputs en orden', (t) => {
  const p0 = make(0)
  const p1 = make(1)
  const inputs = script(400, 7)

  for (let tick = 0; tick < 400; tick++) {
    for (const i of inputs) {
      if (i.tick !== tick) continue
      // cada lado manda su propio input y recibe el del otro en el mismo tick
      const owner = i.player === 0 ? p0 : p1
      const peer = i.player === 0 ? p1 : p0
      const sent = owner.localInput(i.dir)
      if (sent !== null) peer.remoteInput(sent.tick, sent.dir)
    }
    p0.advanceTo(tick + 1)
    p1.advanceTo(tick + 1)
  }

  t.is(p0.hash(), p1.hash(), 'estados identicos tras 400 ticks')
})

test('snake: el rollback reconcilia paquetes que llegan tarde', (t) => {
  const p0 = make(0)
  const p1 = make(1)
  const inputs = script(400, 31)
  const inflight = [] // {deliverAt, to, tick, dir}

  const LATENCY = 3 // ticks de retraso: es lo que obliga a rebobinar

  for (let tick = 0; tick < 400; tick++) {
    // entregar lo que ya le toca llegar
    for (let i = inflight.length - 1; i >= 0; i--) {
      if (inflight[i].deliverAt > tick) continue
      const m = inflight[i]
      m.to.remoteInput(m.tick, m.dir)
      inflight.splice(i, 1)
    }

    for (const i of inputs) {
      if (i.tick !== tick) continue
      const owner = i.player === 0 ? p0 : p1
      const peer = i.player === 0 ? p1 : p0
      const sent = owner.localInput(i.dir)
      if (sent !== null) {
        inflight.push({ deliverAt: tick + LATENCY, to: peer, tick: sent.tick, dir: sent.dir })
      }
    }

    p0.advanceTo(tick + 1)
    p1.advanceTo(tick + 1)
  }

  // drenar lo que quedo en vuelo
  for (const m of inflight) m.to.remoteInput(m.tick, m.dir)
  p0.advanceTo(420)
  p1.advanceTo(420)

  t.ok(p0.rollbacks + p1.rollbacks > 0, 'hubo rollbacks de verdad')
  t.is(p0.hash(), p1.hash(), 'convergen igual que si no hubiera latencia')
})

test('snake: dos teclas en el mismo tick no desincronizan', (t) => {
  // el caso que rompia: derecha → abajo → izquierda dentro de un mismo tick.
  // Aplicados en secuencia local pero guardando solo el ultimo, el replay parte
  // de otra direccion base y las simulaciones se separan.
  const p0 = make(0)
  const p1 = make(1)

  const sent = []
  for (const dir of [2, 3, 0]) {
    const msg = p0.localInput(dir)
    if (msg !== null) sent.push(msg)
  }

  p0.advanceTo(30)
  // el rival los recibe todos tarde, en desorden
  for (const msg of sent.slice().reverse()) p1.remoteInput(msg.tick, msg.dir)
  p1.advanceTo(30)

  t.is(p0.hash(), p1.hash(), 'mismo estado pese al orden y al retraso')
})

test('snake: comer hace crecer y respawnea la comida', (t) => {
  const sim = new Sim(ARENA, SEED)
  const s = sim.state
  const head = s.snakes[0].body[0]
  const { x, y } = sim.unpack(head)

  // poner la comida justo delante de la serpiente 0, que va a la derecha
  s.food = sim.pack(x + 1, y)
  const before = s.snakes[0].body.length

  sim.step(s)

  t.ok(s.snakes[0].body.length > before, 'crecio')
  t.not(s.food, sim.pack(x + 1, y), 'la comida se movio')
  t.ok(s.food >= 0, 'y sigue habiendo comida')
})

test('snake: salirse del tablero mata, y gana la otra', (t) => {
  const sim = new Sim(ARENA, SEED)
  const s = sim.state
  // La posicion inicial las deja enfrentadas y chocarian de frente en el medio,
  // asi que armamos el escenario a mano: la 0 pegada al borde derecho mirando
  // hacia afuera, la 1 lejos y con camino libre.
  s.snakes[0] = { body: [sim.pack(ARENA.w - 1, 2)], dir: 1, alive: true, grow: 0 }
  s.snakes[1] = { body: [sim.pack(5, 5)], dir: 2, alive: true, grow: 0 }
  s.food = sim.pack(20, 15)

  sim.step(s)

  t.not(s.dead, null, 'la partida termino')
  t.is(s.dead.winner, 1, 'gana la que sigue viva')
  t.absent(s.snakes[0].alive)
  t.ok(s.snakes[1].alive)
})

test('snake: frente a frente en la misma celda es empate', (t) => {
  const sim = new Sim(ARENA, SEED)
  const s = sim.state
  const y = 5
  // dos cabezas a distancia par, una yendo a la derecha y la otra a la izquierda
  s.snakes[0] = { body: [sim.pack(10, y)], dir: 1, alive: true, grow: 0 }
  s.snakes[1] = { body: [sim.pack(13, y)], dir: 3, alive: true, grow: 0 }
  s.food = sim.pack(0, 0)

  sim.step(s) // 11 vs 12
  t.is(s.dead, null, 'todavia no se tocan')
  sim.step(s) // los dos a 11.5 → misma celda

  t.not(s.dead, null, 'termino')
  t.is(s.dead.winner, null, 'empate')
})

test('snake: adoptar un snapshot resincroniza', (t) => {
  const p0 = make(0)
  const p1 = make(1)

  p0.advanceTo(50)
  // ensuciar a p1 a proposito, como si hubiera perdido paquetes
  p1.localInput(2)
  p1.advanceTo(50)
  t.not(p0.hash(), p1.hash(), 'estan desincronizados')

  p1.adopt(p0.serialize())
  t.is(p0.hash(), p1.hash(), 'quedaron iguales')

  p0.advanceTo(80)
  p1.advanceTo(80)
  t.is(p0.hash(), p1.hash(), 'y siguen iguales al avanzar')
})
