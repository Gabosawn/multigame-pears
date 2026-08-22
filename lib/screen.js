const tty = require('bare-tty')

// Renderer diferencial.
//
// Antes cada evento hacia `\x1b[2J` (borrar todo) y redibujaba la pantalla
// entera. Con un juego por turnos se nota poco; con un tick de 15 Hz es
// parpadeo puro, y el parpadeo se lee como lag aunque la red este perfecta.
// Buena parte de los "problemas de delay" de este proyecto eran esto.
//
// Aca comparamos el frame nuevo contra el anterior y reescribimos solo las
// lineas que cambiaron, posicionando el cursor de forma absoluta. En un tablero
// de snake donde se mueven dos cabezas, eso son dos o tres lineas por frame en
// vez de treinta.

const ALT_ON = '\x1b[?1049h' // buffer alternativo: al salir, la terminal queda como estaba
const ALT_OFF = '\x1b[?1049l'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR_ALL = '\x1b[2J\x1b[H'
const CLEAR_LINE = '\x1b[K'
const at = (row) => `\x1b[${row + 1};1H`

module.exports = class Screen {
  constructor(fd = 1) {
    this.stdout = new tty.WriteStream(fd)
    this.prev = null
    this.closed = false

    this.stdout.write(ALT_ON + HIDE_CURSOR + CLEAR_ALL)
  }

  get columns() {
    return this.stdout.columns || 80
  }

  get rows() {
    return this.stdout.rows || 24
  }

  on(event, fn) {
    this.stdout.on(event, fn)
  }

  // el proximo render redibuja todo: para resize, o al volver de otro programa
  invalidate() {
    this.prev = null
  }

  render(text) {
    if (this.closed) return

    const next = text.split('\n')
    const prev = this.prev
    const out = []

    if (prev === null) {
      out.push(CLEAR_ALL)
      for (let i = 0; i < next.length; i++) out.push(at(i) + next[i] + CLEAR_LINE)
    } else {
      for (let i = 0; i < next.length; i++) {
        if (next[i] === prev[i]) continue
        out.push(at(i) + next[i] + CLEAR_LINE)
      }
      // el frame se encogio: limpiar lo que quedo abajo
      for (let i = next.length; i < prev.length; i++) out.push(at(i) + CLEAR_LINE)
    }

    this.prev = next
    if (out.length > 0) this.stdout.write(out.join('')) // un solo write, no uno por linea
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.stdout.write(SHOW_CURSOR + ALT_OFF)
  }
}
