#!/usr/bin/env node
'use strict'

// Verifica si un link pear:// esta realmente anunciado en la DHT.
//
// "announced" en la UI de pear seed NO garantiza que el anuncio este publicado:
// si caduca, el seed sigue corriendo tan campante y nadie puede instalar — el
// install del otro lado da ERR_NETWORK_TIMEOUT. Este es el unico chequeo que
// dice la verdad, porque pregunta a la DHT lo mismo que preguntaria un usuario.
//
// Uso:  node scripts/check-seed.js <discovery-key-z32>
// La discovery key sale de:  pear info pear://<tu-link>
//
// Sale con 0 si hay al menos un seeder, 1 si no hay ninguno, 2 si el chequeo
// mismo fallo (sin red, timeout) — que NO es lo mismo que "no hay seeders" y
// por eso el guardian no debe reiniciar nada en ese caso.

const DHT = require('hyperdht')
const z32 = require('z32')

// un lookup normal tarda 1-3s; si no cerro en este plazo, la respuesta es
// "no se pudo verificar", no "esta caido"
const TIMEOUT = 20000

const DISCOVERY = process.argv[2]

if (!DISCOVERY) {
  console.error('Falta la discovery key. Sacala con: pear info pear://<link>')
  process.exit(2)
}

async function lookup() {
  const topic = z32.decode(DISCOVERY)
  const dht = new DHT()
  const seeders = new Set()

  try {
    await dht.ready()
    for await (const res of dht.lookup(topic)) {
      for (const peer of res.peers || []) seeders.add(z32.encode(peer.publicKey))
    }
  } finally {
    await dht.destroy().catch(() => {})
  }

  return seeders
}

async function main() {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`el lookup no cerro en ${TIMEOUT}ms`)), TIMEOUT)
    if (timer.unref) timer.unref()
  })

  let seeders
  try {
    seeders = await Promise.race([lookup(), timeout])
  } finally {
    clearTimeout(timer)
  }

  if (seeders.size === 0) {
    console.log('✖ 0 seeders anunciados. NADIE PUEDE INSTALAR.')
    console.log('  Fix: reiniciar el pear seed (o dejar que seed-guard.sh lo haga).')
    return 1
  }

  console.log(`✔ ${seeders.size} seeder(s) anunciados. El link es instalable.`)
  for (const s of seeders) console.log('  -', s.slice(0, 24))
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('ERROR: no se pudo verificar —', err.message)
    process.exit(2)
  }
)
