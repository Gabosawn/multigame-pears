const fs = require('bare-fs')
const path = require('bare-path')
const b4a = require('b4a')

// Un par de claves que tienen que sobrevivir al reinicio. Existe sobre todo
// para `lastVersion`: es lo que permite detectar que un OTA acaba de aterrizar y
// mostrar que trajo, en vez de que la version nueva aparezca sin explicacion.

module.exports = class Prefs {
  constructor(dir) {
    this.file = path.join(dir, 'prefs.json')
    this.data = {}

    try {
      const parsed = JSON.parse(b4a.toString(fs.readFileSync(this.file)))
      if (parsed !== null && typeof parsed === 'object') this.data = parsed
    } catch {
      // no existe o esta corrupto: los defaults alcanzan
    }
  }

  get(key, fallback = null) {
    const value = this.data[key]
    return value === undefined ? fallback : value
  }

  set(key, value) {
    this.data[key] = value
    try {
      fs.writeFileSync(this.file, b4a.from(JSON.stringify(this.data)))
    } catch {
      // sin disco se pierde la preferencia, no la sesion
    }
  }
}
