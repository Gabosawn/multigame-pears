const test = require('brittle')
const { T, encode, decode } = require('../lib/protocol.js')
const keys = require('../lib/keys.js')

const roundtrip = (msg) => decode(encode(msg))

test('protocolo: los mensajes JSON van y vuelven', (t) => {
  t.alike(roundtrip({ t: T.HELLO, v: '0.4.0' }), { t: T.HELLO, v: '0.4.0' })
  t.alike(roundtrip({ t: T.CHAT, text: 'hola ᛒ' }), { t: T.CHAT, text: 'hola ᛒ' })
  t.alike(roundtrip({ t: T.MOVE, cell: 4 }), { t: T.MOVE, cell: 4 })
  t.alike(roundtrip({ t: T.REMATCH }), { t: T.REMATCH })
})

test('protocolo: input de snake es binario y compacto', (t) => {
  const frame = encode({ t: T.INPUT, tick: 1234, dir: 3 })
  t.is(frame.byteLength, 4, 'cuatro bytes, no cuarenta de JSON')
  t.alike(decode(frame), { t: T.INPUT, tick: 1234, dir: 3 })
})

test('protocolo: el tick del input da la vuelta en 16 bits', (t) => {
  // el contador de ticks se cicla; el codec tiene que ser consistente con eso
  t.alike(decode(encode({ t: T.INPUT, tick: 65535, dir: 1 })), {
    t: T.INPUT,
    tick: 65535,
    dir: 1
  })
  t.alike(decode(encode({ t: T.INPUT, tick: 65536, dir: 1 })), {
    t: T.INPUT,
    tick: 0,
    dir: 1
  })
})

test('protocolo: el sync lleva un hash de 32 bits sin signo', (t) => {
  const frame = encode({ t: T.SYNC, tick: 90, hash: 0xdeadbeef })
  t.is(frame.byteLength, 7)
  t.alike(decode(frame), { t: T.SYNC, tick: 90, hash: 0xdeadbeef })
})

test('protocolo: un peer v0.3.0 sigue pudiendo jugar', (t) => {
  // v0.3.0 mandaba JSON sin discriminador; el OTA no llega a todos a la vez
  t.alike(decode(Buffer.from(JSON.stringify({ cell: 7 }))), { t: T.MOVE, cell: 7 })
  t.alike(decode(Buffer.from(JSON.stringify({ rematch: true }))), { t: T.REMATCH })
})

test('protocolo: la basura se descarta sin tirar el proceso', (t) => {
  t.is(decode(Buffer.alloc(0)), null, 'vacio')
  t.is(decode(Buffer.from([0x01])), null, 'input truncado')
  t.is(decode(Buffer.from([0x02, 0x00, 0x00])), null, 'sync truncado')
  t.is(decode(Buffer.from('no soy json')), null, 'texto suelto')
  t.is(decode(Buffer.from('{roto')), null, 'json invalido')
  t.is(decode(Buffer.from('"soy un string"')), null, 'json que no es objeto')
  t.is(decode(Buffer.from([0xff, 0xfe, 0xfd])), null, 'opcode desconocido')
})

test('teclas: las flechas se decodifican (antes se descartaban)', (t) => {
  t.alike(keys.decode('\x1b[A'), ['up'])
  t.alike(keys.decode('\x1b[B'), ['down'])
  t.alike(keys.decode('\x1b[C'), ['right'])
  t.alike(keys.decode('\x1b[D'), ['left'])
  t.alike(keys.decode('\x1bOA'), ['up'], 'modo aplicacion')
})

test('teclas: un chunk con varias teclas se parte bien', (t) => {
  t.alike(keys.decode('abc'), ['a', 'b', 'c'])
  t.alike(keys.decode('\x1b[Aw\x1b[B'), ['up', 'w', 'down'], 'flechas mezcladas con letras')
  t.alike(keys.decode('hola\r'), ['h', 'o', 'l', 'a', 'enter'])
})

test('teclas: nombres logicos y escape suelto', (t) => {
  t.alike(keys.decode('\x03'), ['ctrl-c'])
  t.alike(keys.decode('\x7f'), ['backspace'])
  t.alike(keys.decode('\x1b'), ['escape'])
  t.alike(keys.decode(' '), [' '], 'el espacio se puede escribir')
})

test('teclas: una secuencia desconocida no se cuela como texto', (t) => {
  // F1 y similares no nos interesan, pero sus bytes no pueden aparecer como
  // teclas sueltas o el chat se llenaria de basura
  t.alike(keys.decode('\x1b[15~'), [])
  t.alike(keys.decode('\x1b[15~x'), ['x'])
})

test('teclas: printable distingue texto de comandos', (t) => {
  t.ok(keys.printable('a'))
  t.ok(keys.printable(' '))
  t.absent(keys.printable('up'))
  t.absent(keys.printable('enter'))
})

test('teclas: se puede escribir en español', (t) => {
  // el filtro era ASCII imprimible, asi que no se podia tipear "ñ" ni un acento
  // ni en el chat ni en el nombre de una sala
  for (const c of ['ñ', 'Ñ', 'á', 'é', 'í', 'ó', 'ú', 'ü', '¿', '¡']) {
    t.ok(keys.printable(c), `se puede escribir ${c}`)
  }
})

test('teclas: los caracteres de control siguen afuera', (t) => {
  t.absent(keys.printable('\x00'))
  t.absent(keys.printable('\x07'), 'bell')
  t.absent(keys.printable('\x1b'), 'escape crudo')
  t.absent(keys.printable('\x7f'), 'delete')
})

test('teclas: un chunk con acentos se decodifica entero', (t) => {
  t.alike(keys.decode('año'), ['a', 'ñ', 'o'])
  t.alike(keys.decode('¿jugamos?\r'), ['¿', 'j', 'u', 'g', 'a', 'm', 'o', 's', '?', 'enter'])
})
