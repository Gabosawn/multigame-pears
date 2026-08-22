const games = [require('./tres-en-raya.js'), require('./snake/index.js')]

exports.all = games
exports.get = (id) => games.find((g) => g.id === id) || null
