// Mide cuanto tarda el emparejamiento segun el intervalo de busqueda.
//
// Existe para settlear una discusion con datos: se sugirio SUBIR el intervalo de
// 3s a 5-8s con el argumento de que refresh() cancela handshakes en vuelo. Eso
// no pasa por este camino (ver el comentario en lib/lobby.js), y la sospecha
// contraria es que el emparejamiento esta DOMINADO por el intervalo, o sea que
// subirlo lo empeora.
//
//   bare test/bench-pairing.js
//
// Corre sobre loopback con una DHT local: no reproduce NAT ni holepunching, pero
// aisla exactamente la variable que se discute.

const DHT = require('hyperdht')
const Lobby = require('../lib/lobby.js')

const INTERVALS = [500, 1000, 2000, 3000, 6000]
const ROUNDS = 3

async function testnet() {
  const bootstrap = new DHT({ bootstrap: [], firewalled: false, ephemeral: false })
  await bootstrap.ready()
  const addr = [{ host: '127.0.0.1', port: bootstrap.address().port }]

  const nodes = []
  for (let i = 0; i < 3; i++) {
    const node = new DHT({ bootstrap: addr, firewalled: false, ephemeral: false })
    await node.ready()
    nodes.push(node)
  }

  return {
    addr,
    async destroy() {
      for (const node of nodes) await node.destroy()
      await bootstrap.destroy()
    }
  }
}

async function once(bootstrap, huntMin, room) {
  const opts = { bootstrap, bluetooth: false, huntMin }
  const a = new Lobby('bench', room, opts)
  const b = new Lobby('bench', room, opts)

  const started = Date.now()
  const both = Promise.all([
    new Promise((resolve) => a.once('paired', resolve)),
    new Promise((resolve) => b.once('paired', resolve))
  ])

  await a.ready()
  await b.ready()

  let elapsed = null
  try {
    await Promise.race([
      both.then(() => {
        elapsed = Date.now() - started
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 30000)
        if (timer.unref) timer.unref()
      })
    ])
  } catch {
    elapsed = null
  }

  await a.close()
  await b.close()
  return elapsed
}

async function main() {
  const net = await testnet()
  console.log('intervalo   emparejamiento (ms)')
  console.log('---------   -------------------')

  for (const huntMin of INTERVALS) {
    const times = []
    for (let round = 0; round < ROUNDS; round++) {
      const ms = await once(net.addr, huntMin, `bench-${huntMin}-${round}`)
      times.push(ms)
    }
    const ok = times.filter((x) => x !== null)
    const avg = ok.length > 0 ? Math.round(ok.reduce((s, x) => s + x, 0) / ok.length) : null
    console.log(
      `${String(huntMin).padStart(6)}ms   ${times.map((x) => (x === null ? 'timeout' : x)).join('  ')}   avg ${avg}`
    )
  }

  await net.destroy()
}

main().catch((err) => {
  console.error(err)
  Bare.exit(1)
})
