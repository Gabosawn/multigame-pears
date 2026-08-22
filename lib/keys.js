// Decodificador de teclas.
//
// La UI vieja iteraba el chunk caracter por caracter y descartaba cualquier
// secuencia de escape multi-byte, asi que las flechas simplemente no existian.
// Para un juego por turnos con teclas 1-9 daba igual; para snake, las flechas
// son LA forma de jugar.
//
// Un chunk de stdin en raw mode puede traer varias teclas juntas (tipeo rapido,
// pegado) y una secuencia de escape llega entera dentro de un chunk. Esto lo
// parte en nombres logicos: 'up', 'enter', 'escape', 'ctrl-c', o el caracter.

const NAMED = {
  '\x03': 'ctrl-c',
  '\r': 'enter',
  '\n': 'enter',
  '\x7f': 'backspace',
  '\b': 'backspace',
  '\t': 'tab'
  // el espacio queda como ' ': tiene que poder escribirse en el chat, y un
  // juego que lo quiera como comando lo compara igual
}

const CSI = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end'
}

function decode(chunk) {
  const keys = []
  let i = 0

  while (i < chunk.length) {
    const c = chunk[i]

    if (c === '\x1b') {
      // CSI: ESC [ <final>  — flechas, home/end
      if (chunk[i + 1] === '[' && CSI[chunk[i + 2]]) {
        keys.push(CSI[chunk[i + 2]])
        i += 3
        continue
      }
      // SS3: ESC O <final> — flechas en modo aplicacion
      if (chunk[i + 1] === 'O' && CSI[chunk[i + 2]]) {
        keys.push(CSI[chunk[i + 2]])
        i += 3
        continue
      }
      // ESC solo, o una secuencia que no nos interesa: consumirla entera para
      // que sus bytes no se cuelen como teclas sueltas
      if (i + 1 >= chunk.length) {
        keys.push('escape')
        return keys
      }
      i += 1
      while (i < chunk.length && !/[A-Za-z~]/.test(chunk[i])) i += 1
      i += 1
      continue
    }

    keys.push(NAMED[c] || c)
    i += 1
  }

  return keys
}

// una tecla que representa texto escribible, no un comando
const printable = (key) => key.length === 1 && key >= ' ' && key <= '~'

module.exports = { decode, printable }
