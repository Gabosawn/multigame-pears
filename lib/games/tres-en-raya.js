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
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]
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
    const c = (i) => state.board[i] || String(i + 1)
    const rows = [0, 3, 6].map((r) => `   ${c(r)} │ ${c(r + 1)} │ ${c(r + 2)}`)
    const done = this.isOver(state)

    let status
    if (done) status = done.draw ? 'Empate.' : done.winner === state.me ? '¡Ganaste!' : 'Perdiste.'
    else status = state.turn === state.me ? 'Tu turno.' : 'Turno del rival…'

    return [
      '',
      `   3 en raya   ·   sos ${state.me}`,
      '',
      rows[0],
      '  ───┼───┼───',
      rows[1],
      '  ───┼───┼───',
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

    return { state: place(state, cell), send: { cell } }
  },

  onPeerMsg(state, msg) {
    const cell = msg?.cell
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return state
    if (state.board[cell] || state.turn === state.me) return state
    return place(state, cell)
  },

  isOver(state) {
    const w = winner(state.board)
    if (w) return { winner: w, draw: false }
    if (state.board.every(Boolean)) return { winner: null, draw: true }
    return null
  }
}
