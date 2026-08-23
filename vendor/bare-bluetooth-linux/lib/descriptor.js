const EventEmitter = require('bare-events')
const binding = require('../binding')

module.exports = exports = class Descriptor extends EventEmitter {
  constructor(adapter, path, uuid) {
    super()
    this._adapter = adapter
    this._path = path
    this._uuid = uuid
  }

  get path() {
    return this._path
  }

  get uuid() {
    return this._uuid
  }

  get flags() {
    if (this._adapter._destroyed) return []
    return binding.descGetFlags(this._adapter._handle, this._path)
  }

  read() {
    if (this._adapter._destroyed) return
    return new Promise((resolve, reject) => {
      binding.descRead(this._adapter._handle, this._path, (err, buffer) => {
        if (err) reject(err)
        else resolve(buffer)
      })
    })
  }

  write(value) {
    if (this._adapter._destroyed) return
    return new Promise((resolve, reject) => {
      binding.descWrite(this._adapter._handle, this._path, value, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Descriptor },
      uuid: this.uuid,
      path: this.path
    }
  }
}
