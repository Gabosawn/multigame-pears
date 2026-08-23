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

// Una tecla que representa texto escribible, no un comando.
//
// Antes esto era `key >= ' ' && key <= '~'`, o sea ASCII imprimible, y en una app
// en español eso significa que no se puede escribir "ñ" ni un acento — ni en el
// chat ni en el nombre de una sala. El filtro estaba por miedo a que el nombre no
// hasheara igual en las dos puntas, pero eso no es un problema: el UTF-8 de la
// misma cadena es identico byte a byte, y el topic sale de ahi.
//
// Lo que si hay que dejar afuera son los caracteres de control, que no son texto
// y ensuciarian la pantalla. Un emoji llega como par surrogate y el decodificador
// lo parte en dos mitades de largo 1: las dos pasan y al concatenarse se
// reconstituye, asi que tambien funciona.
const printable = (key) => {
  if (key.length !== 1) return false
  const code = key.charCodeAt(0)
  return code >= 0x20 && code !== 0x7f
}

module.exports = { decode, printable }
