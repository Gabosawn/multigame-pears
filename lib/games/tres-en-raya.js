const protocol = require('../protocol.js')
const a = require('../ansi.js')

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
]

function winner(board) {
  for (const [x, y, z] of LINES) {
    if (board[x] && board[x] === board[y] && board[x] === board[z]) return board[x]
  }
  return null
}

function place(state, cell) {
  const board = state.board.slice()
  board[cell] = state.turn
  return { ...state, board, turn: state.turn === 'X' ? 'O' : 'X' }
}

module.exports = {
  id: 'tres-en-raya',
  name: '3 en raya',
  players: 2,
  realtime: false,
  help: 'Elegí una casilla con las teclas 1-9',

  init({ first }) {
    return {
      board: new Array(9).fill(null),
      me: first ? 'X' : 'O',
      turn: 'X'
    }
  },

  render(state) {
    const mark = (m) => (m === 'X' ? a.cyan('X') : m === 'O' ? a.magenta('O') : null)
    const c = (i) => mark(state.board[i]) || a.dim(String(i + 1))
    const rows = [0, 3, 6].map((r) => `   ${c(r)} │ ${c(r + 1)} │ ${c(r + 2)}`)
    const done = this.isOver(state)

    let status
    if (done) {
      status =
        done.result === 'draw'
          ? 'Empate.'
          : done.result === 'win'
            ? a.green('¡Ganaste!')
            : a.red('Perdiste.')
    } else {
      status = state.turn === state.me ? 'Tu turno.' : a.dim('Turno del rival…')
    }

    return [
      '',
      `   3 en raya   ${a.dim('·')}   sos ${mark(state.me)}`,
      '',
      rows[0],
      a.dim('  ───┼───┼───'),
      rows[1],
      a.dim('  ───┼───┼───'),
      rows[2],
      '',
      `   ${status}`,
      ''
    ].join('\n')
  },

  onKey(state, key) {
    if (this.isOver(state)) return null
    if (state.turn !== state.me) return null

    const cell = '123456789'.indexOf(key)
    if (cell === -1 || state.board[cell]) return null

    return { state: place(state, cell), send: { t: protocol.T.MOVE, cell } }
  },

  onPeerMsg(state, msg) {
    if (msg.t !== protocol.T.MOVE) return { state }
    const cell = msg.cell
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { state }
    if (state.board[cell] || state.turn === state.me) return { state }
    return { state: place(state, cell) }
  },

  isOver(state) {
    const w = winner(state.board)
    if (w) return { result: w === state.me ? 'win' : 'loss' }
    if (state.board.every(Boolean)) return { result: 'draw' }
    return null
  }
}
