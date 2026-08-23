module.exports = exports = class GattApplication {
  constructor({ path } = {}) {
    this._path = path
    this._services = []
  }

  get path() {
    return this._path
  }

  get services() {
    return this._services
  }

  addService(service) {
    this._services.push(service)
  }

  _reset() {
    for (const svc of this._services) {
      for (const ch of svc.characteristics) {
        ch._reset()
      }
    }
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: GattApplication },
      path: this.path,
      services: this.services
    }
  }
}
