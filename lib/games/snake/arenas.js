// Arenas definidas por datos, no por codigo.
//
// Es a proposito: una arena es un objeto JSON de unos cientos de bytes, asi que
// puede llegar por el canal de contenido — incluso por Bluetooth, en plena
// partida y sin bajar un binario de 98 MB. Agregar una arena no es tocar el
// juego, es agregar un registro.
//
// `walls` se declara con un generador en vez de una lista de celdas para que el
// registro que viaja por la red siga siendo chico.

const PRESETS = {
  // sin obstaculos: el duelo puro
  vacio: () => [],

  // una columna partida al medio, con un hueco para pasar
  muro: (w, h) => {
    const x = Math.floor(w / 2)
    const gap = Math.floor(h / 2)
    const cells = []
    for (let y = 0; y < h; y++) {
      if (y === gap || y === gap - 1) continue
      cells.push(y * w + x)
    }
    return cells
  },

  // cuatro bloques, obliga a girar seguido
  cuadros: (w, h) => {
    const cells = []
    const bw = Math.max(2, Math.floor(w / 8))
    const bh = Math.max(1, Math.floor(h / 5))
    for (const cx of [Math.floor(w / 4), Math.floor((3 * w) / 4)]) {
      for (const cy of [Math.floor(h / 4), Math.floor((3 * h) / 4)]) {
        for (let dx = 0; dx < bw; dx++) {
          for (let dy = 0; dy < bh; dy++) {
            cells.push((cy + dy) * w + (cx + dx))
          }
        }
      }
    }
    return cells
  }
}

function build({ id, name, w, h, preset, tickRate }) {
  const gen = PRESETS[preset] || PRESETS.vacio
  return { id, name, w, h, tickRate, walls: gen(w, h) }
}

// El alto esta atado al layout: el tablero mas el resto de la pantalla tiene que
// entrar en una terminal de 24 filas, que es el default de casi todas. Y NO
// puede depender del tamano de la terminal local: las dos maquinas simulan la
// misma arena o la partida se separa.
const BUILTIN = [
  { id: 'vacio', name: 'Campo abierto', w: 40, h: 15, preset: 'vacio', tickRate: 12 },
  { id: 'muro', name: 'El muro', w: 40, h: 15, preset: 'muro', tickRate: 12 }
]

module.exports = {
  build,
  PRESETS,
  all: BUILTIN.map(build),
  get: (id, extra = []) => {
    const list = BUILTIN.map(build).concat(extra.map(build))
    return list.find((a) => a.id === id) || list[0]
  }
}
