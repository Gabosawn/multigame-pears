// Worker de updates. Basado en hello-pear-worker, con dos cambios:
//   1. delay corto — el updater por defecto agenda las actualizaciones con un
//      retraso aleatorio de hasta 1h, razonable en producción pero imposible
//      de demostrar en vivo.
//   2. sin escrituras a stdout — el proceso padre dibuja un TUI y cualquier
//      console.log le corrompe la pantalla.
const PearRuntime = require('pear-runtime')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')
const path = require('bare-path')
const storage = require('bare-storage')
const { isBareKit } = require('which-runtime')

const UPDATE_DELAY = 5000

// en mobile el argv del worker no trae execPath ni el entrypoint
const argv = (index) => Bare.argv[index + (isBareKit ? 0 : 2)]

const config = {
  updates: argv(0) !== 'false',
  version: argv(1),
  upgrade: argv(2),
  name: argv(3),
  dir: argv(4) || storage.persistent(),
  app: argv(5),
  delay: UPDATE_DELAY
}

const pipe = new FramedStream(Bare.IPC)
const store = new Corestore(path.join(config.dir, 'pear-runtime', 'corestore'))
const swarm = new Hyperswarm()
const pear = new PearRuntime({ ...config, swarm, store })

pear.updater.on('error', (err) => pipe.write('error:' + err.message))

if (config.updates !== false) {
  swarm.on('connection', (connection) => store.replicate(connection))
  // server:true — el boilerplate solo descarga (client). Anunciando tambien,
  // cada copia instalada sirve el drive a las demas: la sala se re-siembra a si
  // misma y la actualizacion llega literalmente de otros jugadores.
  swarm.join(pear.updater.drive.core.discoveryKey, {
    client: true,
    server: true
  })
}

pear.updater.on('updating', () => pipe.write('updating'))
pear.updater.on('updated', () => pipe.write('updated'))

// El updater emite un evento por entrada que va mirroreando. bin.mjs ya
// enganchaba 'updating-delta' pero nadie lo emitia, asi que el OTA se veia como
// un salto de "descargando" a "listo" sin nada en el medio — y son 98 MB.
pear.updater.on('updating-delta', (delta) => {
  let text = ''
  try {
    text = typeof delta === 'string' ? delta : JSON.stringify(delta)
  } catch {
    return
  }
  pipe.write('updating-delta:' + text)
})

pipe.on('data', async (data) => {
  if (data.toString() !== 'pear:applyUpdate') return
  await pear.ready()
  await pear.updater.applyUpdate()
  pipe.write('pear:updateApplied')
})

goodbye(async () => {
  await swarm.destroy()
  await pear.close()
  await store.close()
})
