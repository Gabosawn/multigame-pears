#!/usr/bin/env node
'use strict'

// CLI del autor del contenido: genera la identidad y firma registros.
//
//   node scripts/content.js init                     crea la clave del autor
//   node scripts/content.js arena <id> <nombre> <preset> [tickRate]
//   node scripts/content.js news <version> <nota...>
//   node scripts/content.js list                     lo publicado hasta ahora
//
// La clave privada queda en .content-key.json (gitignored) y NUNCA se publica.
// La publica va hardcodeada en lib/content.js: es lo que hace que un peer no
// pueda inyectarle arenas a nadie.
//
// Los registros firmados se acumulan en content-published.json. Para que la app
// los reparta:  multigame-pears --content content-published.json
// De ahi en adelante viajan de peer a peer, por internet o por Bluetooth.

const fs = require('fs')
const path = require('path')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const record = require('../lib/content-record.js')

const root = path.resolve(__dirname, '..')
const KEY_FILE = path.join(root, '.content-key.json')
const OUT_FILE = path.join(root, 'content-published.json')
const CONTENT_LIB = path.join(root, 'lib', 'content.js')

const PRESETS = ['vacio', 'muro', 'cuadros']

function die(msg) {
  console.error(msg)
  process.exit(1)
}

function loadKey() {
  if (!fs.existsSync(KEY_FILE)) die('No hay clave de autor. Corre primero: npm run content init')
  const { publicKey, secretKey } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'))
  return { publicKey: b4a.from(publicKey, 'hex'), secretKey: b4a.from(secretKey, 'hex') }
}

function loadPublished() {
  if (!fs.existsSync(OUT_FILE)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function publish(entry) {
  const all = loadPublished()
  if (all.some((e) => e.id === entry.id)) die(`Ese registro ya estaba publicado (${entry.id})`)
  all.push(entry)
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2) + '\n')
  console.log(`\n✔ ${entry.kind} firmado y agregado a ${path.relative(root, OUT_FILE)}`)
  console.log(`  id ${entry.id}`)
  console.log(`\nPara repartirlo:\n  multigame-pears --content ${path.relative(root, OUT_FILE)}`)
}

const [cmd, ...args] = process.argv.slice(2)

if (cmd === 'init') {
  if (fs.existsSync(KEY_FILE)) {
    die(`Ya existe ${path.relative(root, KEY_FILE)} — no lo sobreescribo`)
  }

  const keyPair = crypto.keyPair()
  fs.writeFileSync(
    KEY_FILE,
    JSON.stringify(
      {
        publicKey: b4a.toString(keyPair.publicKey, 'hex'),
        secretKey: b4a.toString(keyPair.secretKey, 'hex')
      },
      null,
      2
    ) + '\n'
  )
  fs.chmodSync(KEY_FILE, 0o600)

  const pub = b4a.toString(keyPair.publicKey, 'hex')
  console.log(`✔ clave de autor creada en ${path.relative(root, KEY_FILE)} (no la publiques)\n`)
  console.log('Pega esta clave publica en lib/content.js, en la constante AUTHOR:\n')
  console.log(`const AUTHOR = '${pub}'\n`)
  process.exit(0)
}

if (cmd === 'arena') {
  const [id, name, preset, tickRate] = args
  if (!id || !name) die('Uso: npm run content -- arena <id> <nombre> <preset> [tickRate]')
  if (preset && !PRESETS.includes(preset)) die(`preset invalido. Hay: ${PRESETS.join(', ')}`)

  const { secretKey } = loadKey()
  // w y h son fijos: el tablero tiene que entrar en una terminal de 24 filas, y
  // las dos maquinas simulan la misma arena o la partida se desincroniza
  const data = {
    id,
    name,
    w: 40,
    h: 15,
    preset: preset || 'vacio',
    tickRate: Number(tickRate) || 12
  }
  publish(record.sign('arena', data, secretKey))
  process.exit(0)
}

if (cmd === 'news') {
  const [version, ...notes] = args
  if (!version || notes.length === 0) die('Uso: npm run content -- news <version> <nota...>')

  const { secretKey } = loadKey()
  publish(record.sign('news', { version, notes: [notes.join(' ')] }, secretKey))
  process.exit(0)
}

if (cmd === 'list') {
  const all = loadPublished()
  if (all.length === 0) {
    console.log('Nada publicado todavia.')
    process.exit(0)
  }

  const baked = fs.readFileSync(CONTENT_LIB, 'utf8').match(/const AUTHOR = '([0-9a-f]*)'/)
  const authorKey = baked && baked[1].length === 64 ? b4a.from(baked[1], 'hex') : null

  for (const entry of all) {
    const ok = record.verify(entry, authorKey) ? '✔' : '✖'
    const label = entry.kind === 'arena' ? entry.data.name : `v${entry.data.version}`
    console.log(`${ok} ${entry.kind.padEnd(6)} ${entry.id}  ${label}`)
  }

  if (authorKey === null) {
    console.log('\n⚠ lib/content.js no tiene AUTHOR configurado: la app va a descartar todo esto.')
  }
  process.exit(0)
}

console.error(`Comandos: init | arena | news | list`)
process.exit(1)
