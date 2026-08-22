// Paleta y helpers ANSI, en un solo lugar para que la UI y los juegos no
// inventen cada uno su propio celeste.

const RESET = '\x1b[0m'

const wrap = (code) => (text) => code + text + RESET

module.exports = {
  RESET,
  bold: wrap('\x1b[1m'),
  dim: wrap('\x1b[2m'),
  cyan: wrap('\x1b[36m'),
  magenta: wrap('\x1b[35m'),
  yellow: wrap('\x1b[33m'),
  green: wrap('\x1b[32m'),
  red: wrap('\x1b[31m'),
  brightCyan: wrap('\x1b[96m'),
  brightMagenta: wrap('\x1b[95m'),

  // largo visible, ignorando las secuencias de escape — para centrar y alinear
  width(text) {
    return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length
  }
}
