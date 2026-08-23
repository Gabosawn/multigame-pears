// Backend Linux para ble-swarm. ble-swarm trae backends nativos para
// macOS/iOS/Android (bare-bluetooth) y en Linux resuelve a "unsupported" —
// este puente implementa la misma superficie (Central/Server/Service/
// Characteristic) sobre bare-bluetooth-linux (BlueZ via D-Bus).
//
// Cuidado: nunca destruimos el Adapter — el binding 0.2.0 segfaultea en
// destroy(); el adapter vive lo que vive el proceso, que es lo que ble-swarm
// espera de sus radio managers de todos modos.
const EventEmitter = require('bare-events')

// Un check fallido de libdbus (p.ej. un object path invalido en una carrera
// de registro) ABORTA el proceso entero en builds con warnings fatales — se
// vio en vivo: el juego muerto por SIGABRT en plena busqueda de rival. Con
// esto el check falla como warning, la llamada D-Bus se pierde y el BLE de esa
// sesion queda cojo, pero la partida por internet sigue viva. Tiene que estar
// seteado antes del primer warning, o sea antes de tocar el binding.
try {
  require('bare-os').setEnv('DBUS_FATAL_WARNINGS', '0')
} catch {}

// Vendorizado con DBUS_TIMEOUT 2000→300ms: el binding hace llamadas D-Bus
// sincronas en el loop principal y con 2s cada una la interfaz se congelaba
// entera mientras el GATT enganchaba. Con 300ms son hipos. El arreglo real
// (async) es de upstream; el parche vive en vendor/ con su build.
const BB = require('../vendor/bare-bluetooth-linux')

// BlueZ re-anuncia un device conocido via cambios de RSSI, no con otro
// evento 'device' — re-emitimos 'discover' con esta cadencia minima
const REDISCOVER_MS = 2000

// BlueZ publica el MTU despues de adquirir el notify, no en el momento
const MTU_TRIES = 10
const MTU_RETRY_MS = 300
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

// BlueZ puede SOLTAR un anuncio que ya habia aceptado (Release): el registro
// devuelve ok y un instante despues el controlador falla al programarlo, o el
// demonio decide desalojarlo. Sin escuchar el Release quedabamos invisibles
// para siempre creyendo que anunciabamos — se vio en vivo: RegisterAdvertisement
// "ok" con ActiveInstances clavado en 0. Se reintenta con backoff: si el
// controlador de verdad no puede, el proximo Release vuelve aca y no se spamea.
let advRetryDelay = 1500
let activeServer = null
function watchAdvertisement(a) {
  if (a._advWatched) return
  a._advWatched = true
  a.on('advertisementReleased', () => {
    const uuids = advertisedUUIDs
    advertisedUUIDs = null
    if (uuids === null || activeServer === null) return
    const delay = advRetryDelay
    advRetryDelay = Math.min(advRetryDelay * 2, 30000)
    const timer = setTimeout(() => {
      activeServer?.startAdvertising({ serviceUUIDs: uuids }, true)
    }, delay)
    if (timer.unref) timer.unref()
  })
}

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
    this._registered = null // firma del servicio ya registrado en BlueZ
    activeServer = this // el que re-anuncia si BlueZ suelta el advertisement
    watchAdvertisement(this._adapter)
    // el radio ya esta encendido cuando llegamos aca; avisar async igual que
    // los backends nativos para que el transport enganche sus listeners antes
    queueMicrotask(() => this.emit('stateChange', this.state))
  }

  get state() {
    return this._adapter.powered ? 'poweredOn' : 'poweredOff'
  }

  addService(service) {
    // ble-swarm agrega el servicio DOS veces — al arrancar y cuando el radio
    // avisa poweredOn — y cada pasada hacia unregister+register contra BlueZ.
    // Ese vals en milisegundos era veneno: BlueZ consulta el arbol GATT justo
    // en el medio, y responderle a mitad de mutacion termino en un object path
    // invalido que aborto el juego (assert de libdbus) y, una vez, en un SEGV
    // de bluetoothd entero. Si lo pedido ya esta registrado, no se toca nada:
    // solo se avisa, que es lo que el transport espera para empezar a anunciar.
    const signature = service.uuid + '|' + service.characteristics.map((ch) => ch.uuid).join(',')
    if (this._registered === signature) {
      queueMicrotask(() => this.emit('serviceAdd'))
      return
    }
    this._registered = signature

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
      (err) => {
        this._registered = null // que el proximo intento pueda reintentar
        this.emit('error', err)
      }
    )
  }

  // `_retry` distingue el re-anuncio interno tras un Release: un pedido fresco
  // del transport resetea el backoff, un reintento lo deja crecer
  startAdvertising({ serviceUUIDs }, _retry = false) {
    if (!_retry) advRetryDelay = 1500
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
    this._writeChar = null
    this._mtuDone = false
    this.id = device.address

    device.on('connected', (connected) => {
      if (connected) return
      // ble-swarm engancha su listener de 'error' recien cuando decide
      // MARCARLE a este peripheral; para uno apenas descubierto no escucha
      // nadie, y un emit('error') sin listeners TIRA la excepcion y mata el
      // proceso entero — cualquier dispositivo BLE del vecindario cambiando su
      // estado de conexion volteaba el juego. Sin listener, no es error de
      // nadie: no hay nada que avisar.
      if (this.listenerCount('error') > 0) {
        this.emit('error', new Error('peripheral disconnected'))
      }
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
    this._writeChar = char
    const result = char.write(data, { type: withResponse ? 'request' : 'command' })
    if (!result) return
    result.then(
      () => {
        if (withResponse) this.emit('write')
      },
      (err) => this.emit('error', err)
    )
  }

  // BlueZ negocia el MTU por su cuenta (no se le pide, de ahi que se ignore el
  // valor que pasa el transport) pero publica la propiedad de forma ASINCRONA
  // despues de adquirir el notify. Ese era el bug: si el MTU no estaba listo en
  // el instante exacto de esta llamada, no se emitia nunca y el enlace se
  // quedaba con los 150 bytes por chunk del default de ble-swarm para siempre.
  // Reintentar unas cuantas veces sube el chunk a ~500 bytes, o sea un tercio
  // de los round-trips de radio para la misma cantidad de datos.
  requestMtu() {
    let tries = 0

    const attempt = () => {
      if (this._mtuDone) return

      const mtu = this._readMtu()
      if (mtu !== null) {
        this._mtuDone = true
        this.emit('mtuChanged', mtu)
        return
      }

      if (++tries >= MTU_TRIES) return
      const timer = setTimeout(attempt, MTU_RETRY_MS)
      if (timer.unref) timer.unref()
    }

    attempt()
  }

  // el MTU es de la conexion, no de la characteristic, asi que sirve el de
  // cualquiera de las dos que ya lo tenga resuelto
  _readMtu() {
    for (const char of [this._subscribed, this._writeChar]) {
      const mtu = char?.mtu
      if (typeof mtu === 'number' && mtu > 23) return mtu
    }
    return null
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

  // Corre por cada paquete de advertising de cada device cercano, asi que el
  // orden de los chequeos importa: primero el reloj (una resta) y solo despues
  // el cruce de UUIDs (dos arrays anidados).
  _maybeDiscover(device, p) {
    if (!this._scanning || this._uuids === null) return
    const last = this._lastSeen.get(device.path) || 0
    const now = Date.now()
    if (now - last < REDISCOVER_MS) return
    if (!device.uuids.some((u) => this._uuids.some((f) => uuidEq(f, u)))) return
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
