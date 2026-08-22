// Test de eco BLE entre dos maquinas, sin internet:
//   maquina A:  bare scripts/ble-echo.js miSala
//   maquina B:  bare scripts/ble-echo.js miSala
// Ambas anuncian y escanean; al conectar intercambian "hola" cifrado (Noise).
const BluetoothSwarm = require('ble-swarm')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const bleBackend = require('#ble-backend')

const room = (Bare.argv[2] || 'ble-echo') + ''
const topic = crypto.data(b4a.from('multigame-pears/v1/ble-echo/' + room))
const keyPair = crypto.keyPair()

const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

const opts = { keyPair, topic, pipe: 'gatt', debug: true }
if (bleBackend !== null) opts.backend = bleBackend

const bt = new BluetoothSwarm(opts)
log('backend:', bleBackend ? 'bare-bluetooth-linux (puente)' : 'nativo/por-defecto')
log('supported:', bt.supported, '— sala:', room)

if (!bt.supported) {
  console.error('BLE no soportado en esta plataforma')
  Bare.exit(1)
}

bt.on('update', () => log('estado:', bt.state, '· peers:', bt.peers))

bt.on('connection', (conn) => {
  log('CONEXION BLE con', b4a.toString(conn.remotePublicKey, 'hex').slice(0, 8))
  conn.on('data', (data) => log('recibido:', b4a.toString(data)))
  conn.on('error', (err) => log('conn error:', err.message))
  conn.on('close', () => log('conn cerrada'))
  conn.write(b4a.from('hola desde ' + b4a.toString(keyPair.publicKey, 'hex').slice(0, 8)))
  setInterval(() => conn.write(b4a.from('ping ' + new Date().toISOString().slice(17, 23))), 3000)
})

bt.start().then(
  () => log('BLE swarm arrancado — esperando al otro lado…'),
  (err) => {
    console.error('fallo al arrancar:', err.message)
    Bare.exit(1)
  }
)
