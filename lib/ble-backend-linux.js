// Backend Linux para ble-swarm. ble-swarm trae backends nativos para
// macOS/iOS/Android (bare-bluetooth) y en Linux resuelve a "unsupported" —
// este puente implementa la misma superficie (Central/Server/Service/
// Characteristic) sobre bare-bluetooth-linux (BlueZ via D-Bus).
//
// Cuidado: nunca destruimos el Adapter — el binding 0.2.0 segfaultea en
// destroy(); el adapter vive lo que vive el proceso, que es lo que ble-swarm
// espera de sus radio managers de todos modos.
const EventEmitter = require('bare-events')
const BB = require('bare-bluetooth-linux')

// BlueZ re-anuncia un device conocido via cambios de RSSI, no con otro
// evento 'device' — re-emitimos 'discover' con esta cadencia minima
const REDISCOVER_MS = 2000
const uuidEq = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

// un solo adapter D-Bus por proceso, compartido por Central y Server
let adapter = null
function getAdapter() {
  if (adapter === null) {
    adapter = new BB.Adapter()
    if (!adapter.powered) adapter.powered = true
  }
  return adapter
}

// BlueZ admite UNA app GATT y UN advertisement por conexion D-Bus, y sus
// registros no toleran concurrencia: toda operacion pasa por esta cola unica.
// Al cambiar de sala (otro service UUID) se suelta lo anterior y gana el nuevo.
let gattQueue = Promise.resolve()
let advertisedUUIDs = null

function enqueueGatt(fn) {
  const run = gattQueue.then(fn)
  gattQueue = run.then(
    () => {},
    () => {}
  )
  return run
}

async function releaseGatt(a) {
  if (advertisedUUIDs !== null) {
    advertisedUUIDs = null
    try {
      await a.unregisterAdvertisement()
    } catch {}
  }
  if (a._gattApp) {
    try {
      await a.unregisterApplication(a._gattApp)
    } catch {}
  }
}

class Characteristic {
  constructor(uuid, opts = {}) {
    this.uuid = uuid
    this.opts = opts
    this._gatt = null
  }

  _flags() {
    const flags = []
    if (this.opts.read) flags.push('read')
    if (this.opts.write) flags.push('write')
    if (this.opts.writeWithoutResponse) flags.push('write-without-response')
    if (this.opts.notify) flags.push('notify')
    return flags
  }
}

class Service {
  constructor(uuid, characteristics = []) {
    this.uuid = uuid
    this.characteristics = characteristics
  }
}

class Server extends EventEmitter {
  static ATT_SUCCESS = 0

  constructor() {
    super()
    this._adapter = getAdapter()
    // el radio ya esta encendido cuando llegamos aca; avisar async igual que
    // los backends nativos para que el transport enganche sus listeners antes
    queueMicrotask(() => this.emit('stateChange', this.state))
  }

  get state() {
    return this._adapter.powered ? 'poweredOn' : 'poweredOff'
  }

  addService(service) {
    const app = new BB.GattApplication({ path: '/multigame' })
    const gattService = new BB.GattService({ uuid: service.uuid })
    for (const ch of service.characteristics) {
      ch._gatt = new BB.GattCharacteristic({ uuid: ch.uuid, flags: ch._flags() })
      // BlueZ ya respondio el write a nivel ATT: no hay respuesta pendiente
      ch._gatt.on('write', (value) => {
        this.emit('writeRequest', [{ characteristic: ch, data: value, responseNeeded: false }])
      })
      gattService.addCharacteristic(ch._gatt)
    }
    app.addService(gattService)
    enqueueGatt(async () => {
      await releaseGatt(this._adapter)
      await this._adapter.registerApplication(app)
    }).then(
      () => this.emit('serviceAdd'),
      (err) => this.emit('error', err)
    )
  }

  startAdvertising({ serviceUUIDs }) {
    enqueueGatt(async () => {
      if (advertisedUUIDs !== null) {
        if (advertisedUUIDs.join() === serviceUUIDs.join()) return
        advertisedUUIDs = null
        await this._adapter.unregisterAdvertisement().catch(() => {})
      }
      await this._adapter.registerAdvertisement(new BB.Advertisement({ serviceUUIDs }))
      advertisedUUIDs = serviceUUIDs.slice()
    }).catch((err) => this.emit('error', err))
  }

  // el notify de BlueZ (PropertiesChanged) no tiene backpressure: siempre acepta
  updateValue(char, frame) {
    if (char._gatt === null) return false
    char._gatt.value = frame
    return true
  }

  respondToRequest() {} // BlueZ responde solo — nada que hacer

  stopAdvertising() {
    enqueueGatt(async () => {
      if (advertisedUUIDs === null) return
      advertisedUUIDs = null
      await this._adapter.unregisterAdvertisement()
    }).catch(() => {})
  }
}

class Peripheral extends EventEmitter {
  constructor(central, device) {
    super()
    this._central = central
    this._device = device
    this._subscribed = null
    this.id = device.address

    device.on('connected', (connected) => {
      if (!connected) this.emit('error', new Error('peripheral disconnected'))
    })
  }

  discoverServices(uuids) {
    const services = [...this._device.services.values()].filter((s) =>
      uuids.some((u) => uuidEq(u, s.uuid))
    )
    queueMicrotask(() => this.emit('servicesDiscover', services))
  }

  discoverCharacteristics(svc, uuids) {
    const match = () =>
      [...svc.characteristics.values()].filter((c) => uuids.some((u) => uuidEq(u, c.uuid)))
    const found = match()
    if (found.length > 0) {
      queueMicrotask(() => this.emit('characteristicsDiscover', svc, found))
      return
    }
    // resolucion GATT todavia goteando por D-Bus: esperar la characteristic
    const onchar = () => {
      const now = match()
      if (now.length === 0) return
      svc.removeListener('characteristic', onchar)
      this.emit('characteristicsDiscover', svc, now)
    }
    svc.on('characteristic', onchar)
  }

  subscribe(char) {
    char.on('data', (buf) => this.emit('notify', char, buf))
    char.startNotify().then(
      () => {
        this._subscribed = char
        this.emit('notifyState', char, true)
      },
      (err) => this.emit('error', err)
    )
  }

  write(char, data, withResponse) {
    const result = char.write(data, { type: withResponse ? 'request' : 'command' })
    if (!result) return
    result.then(
      () => {
        if (withResponse) this.emit('write')
      },
      (err) => this.emit('error', err)
    )
  }

  requestMtu() {
    const mtu = this._subscribed?.mtu
    if (typeof mtu === 'number' && mtu > 23) this.emit('mtuChanged', mtu)
  }
}

class Central extends EventEmitter {
  constructor() {
    super()
    this._adapter = getAdapter()
    this._uuids = null
    this._scanning = false
    this._peripherals = new Map() // device path → Peripheral
    this._lastSeen = new Map() // device path → ts del ultimo discover

    this._adapter.on('device', (device) => this._track(device))
    // devices que BlueZ ya conocia de antes
    for (const device of this._adapter.devices.values()) this._track(device)

    queueMicrotask(() => this.emit('stateChange', this.state))
  }

  get state() {
    return this._adapter.powered ? 'poweredOn' : 'poweredOff'
  }

  _track(device) {
    if (this._peripherals.has(device.path)) return
    const p = new Peripheral(this, device)
    this._peripherals.set(device.path, p)
    this._maybeDiscover(device, p)
    device.on('rssi', () => this._maybeDiscover(device, p))
  }

  _maybeDiscover(device, p) {
    if (!this._scanning || this._uuids === null) return
    if (!device.uuids.some((u) => this._uuids.some((f) => uuidEq(f, u)))) return
    const last = this._lastSeen.get(device.path) || 0
    const now = Date.now()
    if (now - last < REDISCOVER_MS) return
    this._lastSeen.set(device.path, now)
    this.emit('discover', p)
  }

  startScan(uuids) {
    this._uuids = uuids
    this._scanning = true
    try {
      this._adapter.setDiscoveryFilter({ uuids, transport: 'le' })
      if (!this._adapter.discovering) this._adapter.startDiscovery()
    } catch (err) {
      this.emit('error', err)
    }
    // lo ya visto cuenta como descubierto en esta pasada
    for (const [path, p] of this._peripherals) {
      const device = this._adapter.devices.get(path)
      if (device) this._maybeDiscover(device, p)
    }
  }

  stopScan() {
    this._scanning = false
    try {
      if (this._adapter.discovering) this._adapter.stopDiscovery()
    } catch {}
  }

  connect(peripheral) {
    const device = peripheral._device
    device
      .connect()
      .then(() => this._resolved(device))
      .then(() => this.emit('connect', peripheral))
      .catch((err) => peripheral.emit('error', err))
  }

  // esperar a que BlueZ resuelva la base GATT del device
  _resolved(device) {
    if (device.servicesResolved) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const onresolved = (ok) => {
        if (!ok) return
        cleanup()
        resolve()
      }
      const onconnected = (connected) => {
        if (connected) return
        cleanup()
        reject(new Error('disconnected before services resolved'))
      }
      const cleanup = () => {
        device.removeListener('servicesResolved', onresolved)
        device.removeListener('connected', onconnected)
      }
      device.on('servicesResolved', onresolved)
      device.on('connected', onconnected)
    })
  }

  disconnect(peripheral) {
    peripheral._device.disconnect().catch(() => {})
  }
}

module.exports = { Central, Server, Service, Characteristic }
