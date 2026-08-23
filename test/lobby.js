const test = require('brittle')
const DHT = require('hyperdht')
const Lobby = require('../lib/lobby.js')
const protocol = require('../lib/protocol.js')

// DHT local para los tests.
//
// Sin esto habria que salir a la DHT publica: el test tardaria segundos, fallaria
// sin internet y mediria la red del CI en vez del codigo. Con una bootstrap local
// el emparejamiento se prueba en milisegundos y de forma deterministica.
//
// Ojo con lo que este test NO puede probar: corre sobre loopback, asi que no
// reproduce holepunching a traves de NAT. Un emparejamiento lento entre dos
// maquinas en redes distintas es NAT o firewall, y eso solo se ve con dos
// maquinas de verdad. Aca se prueba que la logica del lobby es correcta y que no
// se rompe con un cambio.
async function testnet(t) {
  const bootstrap = new DHT({ bootstrap: [], firewalled: false, ephemeral: false })
  await bootstrap.ready()
  const addr = [{ host: '127.0.0.1', port: bootstrap.address().port }]

  // una bootstrap sola no alcanza: la DHT necesita nodos que respondan queries
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

function lobby(t, room, bootstrap) {
  // bluetooth apagado: los tests no dependen de que la maquina tenga radio, y
  // dos procesos peleando por la misma app GATT de BlueZ es otro test
  const l = new Lobby('snake', room, { bootstrap, bluetooth: false })
  t.teardown(() => l.close())
  return l
}

const paired = (l) => new Promise((resolve) => l.once('paired', resolve))
const message = (l) => new Promise((resolve) => l.once('message', resolve))
const deadline = (ms, what) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${what}`)), ms).unref?.())

test('lobby: dos peers en la misma sala emparejan y se hablan', async (t) => {
  const bootstrap = await testnet(t)

  const a = lobby(t, 'sala-de-prueba', bootstrap)
  const b = lobby(t, 'sala-de-prueba', bootstrap)

  const both = Promise.all([paired(a), paired(b)])
  await a.ready()
  await b.ready()

  const started = Date.now()
  const [pa, pb] = await Promise.race([both, deadline(5000, 'emparejamiento en 5s')])
  const elapsed = Date.now() - started

  t.ok(elapsed < 5000, `emparejaron en ${elapsed}ms`)
  t.is(pa.via, 'internet')
  t.is(pb.via, 'internet')

  // los dos lados tienen que estar de acuerdo en quien empieza, sin round trip
  t.not(pa.first, pb.first, 'roles opuestos')

  // y calcular la MISMA semilla sin intercambiar nada: de eso depende que la
  // comida de snake caiga en el mismo lugar en las dos pantallas
  t.is(pa.seed, pb.seed, 'misma semilla derivada de las pubkeys')
  t.ok(Number.isInteger(pa.seed), 'la semilla es un entero')

  // ida y vuelta por el stream
  const gotB = message(b)
  a.send({ t: protocol.T.CHAT, text: 'hola' })
  t.alike(await Promise.race([gotB, deadline(5000, 'mensaje a→b')]), {
    t: protocol.T.CHAT,
    text: 'hola'
  })

  const gotA = message(a)
  b.send({ t: protocol.T.MOVE, cell: 4 })
  t.alike(await Promise.race([gotA, deadline(5000, 'mensaje b→a')]), {
    t: protocol.T.MOVE,
    cell: 4
  })
})

test('lobby: salas distintas no se ven', async (t) => {
  const bootstrap = await testnet(t)

  const a = lobby(t, 'sala-uno', bootstrap)
  const b = lobby(t, 'sala-dos', bootstrap)

  let crossed = false
  a.on('paired', () => (crossed = true))
  b.on('paired', () => (crossed = true))

  await a.ready()
  await b.ready()
  await new Promise((resolve) => setTimeout(resolve, 3000).unref?.())

  t.absent(crossed, 'el nombre de la sala separa de verdad')
})

test('lobby: un tercero no interrumpe una partida en curso', async (t) => {
  const bootstrap = await testnet(t)

  const a = lobby(t, 'sala-llena', bootstrap)
  const b = lobby(t, 'sala-llena', bootstrap)

  await a.ready()
  await b.ready()
  await Promise.race([Promise.all([paired(a), paired(b)]), deadline(5000, 'primer par')])

  // el tercero entra a la misma sala: los dos que ya juegan no se enteran
  const c = lobby(t, 'sala-llena', bootstrap)
  let disturbed = false
  a.on('paired', () => (disturbed = true))
  b.on('paired', () => (disturbed = true))
  a.on('peer-lost', () => (disturbed = true))
  b.on('peer-lost', () => (disturbed = true))

  await c.ready()
  await new Promise((resolve) => setTimeout(resolve, 3000).unref?.())

  t.absent(disturbed, 'la mesa ocupada rechaza al que llega')

  // y los dos originales siguen hablandose
  const got = message(b)
  a.send({ t: protocol.T.CHAT, text: 'seguimos' })
  t.alike(await Promise.race([got, deadline(5000, 'siguen conectados')]), {
    t: protocol.T.CHAT,
    text: 'seguimos'
  })
})

test('lobby: el handshake no se pierde cuando los dos se marcan a la vez', async (t) => {
  // La regresion que arreglo esto: al descubrirse en el mismo instante, los dos
  // marcan, hyperswarm mata un socket por dedup y lo escrito en el perdedor se
  // va con el destroy(). El handshake de la app (HELLO, CONTENT_HAVE, MATCH) se
  // manda exactamente ahi, en el handler de 'paired', asi que el rival quedaba
  // sin saber en que arena jugar.
  //
  // Se repite varias veces porque es una carrera: una sola pasada puede tener
  // suerte.
  const bootstrap = await testnet(t)
  const ROUNDS = 5

  for (let round = 0; round < ROUNDS; round++) {
    const a = new Lobby('snake', `carrera-${round}`, { bootstrap, bluetooth: false })
    const b = new Lobby('snake', `carrera-${round}`, { bootstrap, bluetooth: false })

    // enviar DENTRO del handler de paired, que es el instante de la carrera
    a.on('paired', () => a.send({ t: protocol.T.HELLO, v: 'soy-a' }))
    b.on('paired', () => b.send({ t: protocol.T.HELLO, v: 'soy-b' }))

    const gotA = message(a)
    const gotB = message(b)

    await a.ready()
    await b.ready()

    const [ma, mb] = await Promise.race([
      Promise.all([gotA, gotB]),
      deadline(10000, `handshake en la ronda ${round}`)
    ])

    t.is(ma.v, 'soy-b', `ronda ${round}: a recibio el handshake de b`)
    t.is(mb.v, 'soy-a', `ronda ${round}: b recibio el handshake de a`)
    t.absent(ma.n, 'el numero de secuencia no se filtra a la app')

    await a.close()
    await b.close()
  }
})

test('lobby: los inputs sobreviven el swap de sockets a mitad de partida', async (t) => {
  // El dedup de hyperswarm puede matar el socket perdedor SEGUNDOS despues de
  // emparejar (medido: ~6s sobre loopback), o sea en plena partida. Un INPUT
  // que viajaba en ese socket se iba con el destroy() — es efimero, no se
  // reenviaba — y las dos simulaciones de snake quedaban separadas hasta que
  // el chequeo de hash pedia un snapshot completo. El fallo de CI en macOS y
  // Windows era exactamente esto: alli el test es mas lento y el swap caia
  // dentro de la ventana de inputs. Aca se manda trafico continuo a traves de
  // esa ventana y no se puede perder ni uno.
  const bootstrap = await testnet(t)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.())

  const a = lobby(t, 'swap-inputs', bootstrap)
  const b = lobby(t, 'swap-inputs', bootstrap)

  const gotA = new Map()
  const gotB = new Map()
  let chatsB = 0
  a.on('message', (m) => {
    if (m.t === protocol.T.INPUT) gotA.set(m.tick, m.dir)
  })
  b.on('message', (m) => {
    if (m.t === protocol.T.INPUT) gotB.set(m.tick, m.dir)
    if (m.t === protocol.T.CHAT) chatsB += 1
  })

  const both = Promise.all([paired(a), paired(b)])
  await a.ready()
  await b.ready()
  await Promise.race([both, deadline(5000, 'emparejamiento')])

  // un swap del mismo rival NO es un emparejamiento nuevo
  let repaired = false
  a.on('paired', () => (repaired = true))
  b.on('paired', () => (repaired = true))

  // ~8s de trafico: cubre de sobra la ventana tipica del dedup
  for (let tick = 1; tick <= 80; tick++) {
    a.send({ t: protocol.T.INPUT, tick, dir: tick % 4 })
    b.send({ t: protocol.T.INPUT, tick, dir: (tick + 1) % 4 })
    if (tick % 20 === 0) a.send({ t: protocol.T.CHAT, text: `hito ${tick}` })
    await sleep(100)
  }
  await sleep(1000) // que aterrice lo que el ultimo swap haya reenviado

  // repetido vale (el netcode ignora duplicados); perdido no
  let missingA = 0
  let missingB = 0
  for (let tick = 1; tick <= 80; tick++) {
    if (gotB.get(tick) !== tick % 4) missingB += 1
    if (gotA.get(tick) !== (tick + 1) % 4) missingA += 1
  }
  t.is(missingB, 0, 'b recibio los 80 inputs de a')
  t.is(missingA, 0, 'a recibio los 80 inputs de b')
  t.is(chatsB, 4, 'los numerados llegaron exactamente una vez cada uno')
  t.absent(repaired, 'el swap no reinicio la partida')
})
