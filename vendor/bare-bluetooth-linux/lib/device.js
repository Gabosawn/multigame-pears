const EventEmitter = require('bare-events')
const binding = require('../binding')

module.exports = exports = class Device extends EventEmitter {
  constructor(adapter, path, address) {
    super()
    this._adapter = adapter
    this._path = path
    this._address = address
    this._services = new Map()
  }

  get services() {
    return this._services
  }

  get path() {
    return this._path
  }

  get address() {
    return this._address
  }

  get name() {
    if (this._adapter._destroyed) return
    return binding.deviceGetName(this._adapter._handle, this._path)
  }

  get rssi() {
    if (this._adapter._destroyed) return
    return binding.deviceGetRSSI(this._adapter._handle, this._path)
  }

  get paired() {
    if (this._adapter._destroyed) return
    return binding.deviceGetPaired(this._adapter._handle, this._path)
  }

  get connected() {
    if (this._adapter._destroyed) return
    return binding.deviceGetConnected(this._adapter._handle, this._path)
  }

  get servicesResolved() {
    if (this._adapter._destroyed) return
    return binding.deviceGetServicesResolved(this._adapter._handle, this._path)
  }

  get uuids() {
    if (this._adapter._destroyed) return []
    return binding.deviceGetUUIDs(this._adapter._handle, this._path)
  }

  get manufacturerData() {
    if (this._adapter._destroyed) return {}
    const result = {}
    binding.deviceGetManufacturerData(this._adapter._handle, this._path, result)
    return result
  }

  get serviceData() {
    if (this._adapter._destroyed) return {}
    const result = {}
    binding.deviceGetServiceData(this._adapter._handle, this._path, result)
    return result
  }

  connect() {
    if (this._adapter._destroyed) return
    return new Promise((resolve, reject) => {
      binding.deviceConnect(this._adapter._handle, this._path, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  disconnect() {
    if (this._adapter._destroyed) return
    return new Promise((resolve, reject) => {
      binding.deviceDisconnect(this._adapter._handle, this._path, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  pair() {
    if (this._adapter._destroyed) return
    return new Promise((resolve, reject) => {
      binding.devicePair(this._adapter._handle, this._path, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Device },
      path: this.path,
      address: this.address,
      name: this.name
    }
  }
}
