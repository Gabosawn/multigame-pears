const EventEmitter = require('bare-events')
const binding = require('../binding')

module.exports = exports = class Service extends EventEmitter {
  constructor(device, path, uuid) {
    super()
    this._device = device
    this._path = path
    this._uuid = uuid
    this._characteristics = new Map()
  }

  get path() {
    return this._path
  }

  get uuid() {
    return this._uuid
  }

  get characteristics() {
    return this._characteristics
  }

  get primary() {
    if (this._device._adapter._destroyed) return
    return binding.serviceIsPrimary(this._device._adapter._handle, this._path)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Service },
      uuid: this.uuid,
      primary: this.primary
    }
  }
}
