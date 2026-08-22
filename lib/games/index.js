const games = [require('./tres-en-raya.js')]

exports.all = games
exports.get = (id) => games.find((g) => g.id === id) || null
