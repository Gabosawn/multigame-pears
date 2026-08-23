import { command, flag, summary } from 'paparam'
import { persistent } from 'bare-storage'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import fs from 'bare-fs'
import pkg from './package.json'
import tty from 'bare-tty'
import App from './app.js'
import UI from './lib/ui.js'
import Content from './lib/content.js'
import Prefs from './lib/prefs.js'

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

const cmd = command(
  appName,
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--storage <dir>', 'custom storage directory'),
  flag('--no-updates', 'disable OTA updates for this run'),
  // El puente BLE de Linux (bare-bluetooth-linux 0.2.0) hace llamadas D-Bus
  // sincronas de hasta 2s en el loop principal: cuando una conexion GATT
  // engancha de verdad, la interfaz entera se congela. Hasta que upstream sea
  // asincrono, este flag permite jugar por internet sin que el radio moleste.
  flag('--no-bluetooth', 'buscar rival solo por internet (el BLE de Linux es experimental)'),
  flag('--content <file>', 'publicar registros de contenido firmados desde un archivo')
)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const updates = cmd.flags.updates
const storage = cmd.flags.storage || (isDev ? null : path.join(persistent(), appName))
const dir = storage || path.join(os.tmpdir(), 'pear', appName)

// el storage tiene que existir antes de que content y prefs escriban en el
fs.mkdirSync(dir, { recursive: true })

const app = new App({
  dir,
  app: isDev ? null : os.execPath(),
  updates,
  version: pkg.version,
  upgrade: pkg.upgrade,
  name: isWindows ? appName + '.exe' : appName
})

const prefs = new Prefs(dir)
const content = new Content({ dir }).load()

// El autor publica inyectando registros firmados; de ahi en adelante viajan de
// peer a peer con cada partida, por internet o por Bluetooth.
if (cmd.flags.content) {
  const added = content.loadFile(path.resolve(cmd.flags.content))
  if (!content.enabled) {
    console.error('El canal de contenido no tiene AUTHOR configurado en lib/content.js.')
    Bare.exit(1)
  }
  if (added === 0) console.error(`Nada nuevo en ${cmd.flags.content} (o las firmas no verifican).`)
}

let ui = null

// el TUI es dueño de la pantalla, así que los eventos del updater van a su línea
// de estado — un console.log suelto le corrompe el tablero
const update = (text) => ui?.setUpdateState(text)

app.on('updating', () => update('actualización encontrada, descargando…'))
// el worker manda el evento crudo del mirror (un JSON por entrada): mostrarlo
// tal cual era ver {"op":"add",...,"bytesAdded":98926256} congelado en la barra
// y jurar que se colgó — cuando en realidad los 98MB bajaban en silencio.
const prettyDelta = (raw) => {
  try {
    const d = JSON.parse(raw)
    const name =
      String(d.key || '')
        .split('/')
        .pop() || 'archivo'
    const mb = d.bytesAdded > 0 ? ` (${(d.bytesAdded / 1e6).toFixed(1)}MB)` : ''
    return `${name}${mb}…`
  } catch {
    return raw
  }
}

app.on('updating-delta', (delta) => update(`descargando la actualización: ${prettyDelta(delta)}`))
app.on('updated', () => update('actualización descargada, aplicando…'))
app.on('update-applied', () => update('nueva versión lista — reiniciá para jugarla'))
app.on('error', (err) => update(`error: ${err.message}`))

async function shutdown(code = 0) {
  await ui?.close()
  await app.exit(code)
}

process.on('SIGHUP', () => shutdown(129))
process.on('SIGINT', () => shutdown(130))
process.on('SIGQUIT', () => shutdown(131))
process.on('SIGTERM', () => shutdown(143))

if (!tty.isTTY(0) || !tty.isTTY(1)) {
  console.error(`${appName} necesita una terminal interactiva.`)
  Bare.exit(1)
}

try {
  await app.ready()

  ui = new UI({ version: pkg.version, content, prefs, bluetooth: cmd.flags.bluetooth })
  ui.onclose = () => shutdown(0)
  ui.render()
} catch (err) {
  console.error('[app:error]', err)
  await app.close().finally(() => Bare.exit(1))
}
