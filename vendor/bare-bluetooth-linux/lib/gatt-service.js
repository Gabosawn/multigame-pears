module.exports = exports = class GattService {
  constructor({ uuid, primary = true } = {}) {
    this._uuid = uuid
    this._primary = primary
    this._characteristics = []
  }

  get uuid() {
    return this._uuid
  }

  get primary() {
    return this._primary
  }

  get characteristics() {
    return this._characteristics
  }

  addCharacteristic(characteristic) {
    this._characteristics.push(characteristic)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: GattService },
      uuid: this.uuid,
      primary: this.primary,
      characteristics: this.characteristics
    }
  }
}
