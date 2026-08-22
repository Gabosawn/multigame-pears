// Protocolo entre los dos peers de una partida.
//
// Antes cada mensaje era un objeto JSON suelto sin discriminador: el juego
// miraba `msg.cell` y la UI interceptaba `msg.rematch`. Con un solo juego y sin
// chat eso alcanzaba; con tres tipos de mensaje distintos es una colision
// esperando. Ahora todo mensaje lleva un campo `t`.
//
// Dos decisiones que valen la pena explicar:
//
//   1. **Compatibilidad hacia atras.** Un peer v0.3.0 manda `{"cell":4}` sin
//      `t`. Como el OTA no llega a todos a la vez, durante una version tratamos
//      un JSON sin `t` como un movimiento: un jugador viejo puede seguir
//      jugando contra uno nuevo en vez de ver la partida romperse.
//
//   2. **Binario en el camino caliente.** Snake manda un frame por cambio de
//      direccion y un hash de sincronia cada tantos ticks. En JSON eso son
//      ~40 bytes; en binario son 4. Sobre BLE, donde cada chunk cuesta un
//      round-trip de radio, la diferencia importa. El discriminador es gratis:
//      un JSON siempre empieza con `{` (0x7b), asi que cualquier primer byte
//      chico es un opcode binario.

const b4a = require('b4a')

const T = {
  HELLO: 'hello', // { v } version del peer, al emparejar
  PING: 'ping', // { ts } medicion de RTT
  PONG: 'pong', // { ts } eco del ping, con el ts original
  MOVE: 'move', // { ...datos del juego por turnos }
  CHAT: 'chat', // { text }
  REMATCH: 'rematch', // revancha
  INPUT: 'input', // { tick, dir } snake, binario
  SYNC: 'sync', // { tick, hash } chequeo de desincronizacion, binario
  STATE: 'state', // { ...snapshot } recuperacion tras desync

  // El anfitrion anuncia la arena de cada partida y la manda ENTERA, no por id.
  // Asi el rival puede jugar en una arena que todavia no tenia: no hace falta
  // negociar que tiene cada uno, y como el registro viene firmado se puede
  // confiar en el. Es lo que permite que una arena nueva se estrene en el acto.
  MATCH: 'match', // { arena, no }

  // Gossip de contenido: cada lado dice que ids tiene y el otro le manda lo que
  // le falta. Son unos cientos de bytes, asi que pasa por Bluetooth sin drama.
  CONTENT_HAVE: 'chave', // { ids }
  CONTENT_GIVE: 'cgive' // { records }
}

// `n` es un campo de TRANSPORTE, no de aplicacion: lo agrega y lo saca
// lib/lobby.js. Numera los mensajes no efimeros para poder reenviarlos cuando el
// socket se reemplaza y descartar los que el otro lado ya vio. Los juegos y la
// UI nunca lo ven.

const OP_INPUT = 0x01
const OP_SYNC = 0x02

const JSON_FIRST_BYTE = 0x7b // '{'

function encode(msg) {
  if (msg.t === T.INPUT) {
    const buf = b4a.allocUnsafe(4)
    buf[0] = OP_INPUT
    buf.writeUInt16LE(msg.tick & 0xffff, 1)
    buf[3] = msg.dir & 0xff
    return buf
  }

  if (msg.t === T.SYNC) {
    const buf = b4a.allocUnsafe(7)
    buf[0] = OP_SYNC
    buf.writeUInt16LE(msg.tick & 0xffff, 1)
    buf.writeUInt32LE(msg.hash >>> 0, 3)
    return buf
  }

  return b4a.from(JSON.stringify(msg))
}

function decode(buf) {
  if (buf.byteLength === 0) return null

  const op = buf[0]

  if (op === OP_INPUT) {
    if (buf.byteLength < 4) return null
    return { t: T.INPUT, tick: buf.readUInt16LE(1), dir: buf[3] }
  }

  if (op === OP_SYNC) {
    if (buf.byteLength < 7) return null
    return { t: T.SYNC, tick: buf.readUInt16LE(1), hash: buf.readUInt32LE(3) }
  }

  if (op !== JSON_FIRST_BYTE) return null

  let msg = null
  try {
    msg = JSON.parse(b4a.toString(buf))
  } catch {
    return null
  }
  if (msg === null || typeof msg !== 'object') return null

  // peer v0.3.0: JSON sin discriminador
  if (typeof msg.t !== 'string') {
    if (msg.rematch === true) return { t: T.REMATCH }
    return { ...msg, t: T.MOVE }
  }

  return msg
}

module.exports = { T, encode, decode }
