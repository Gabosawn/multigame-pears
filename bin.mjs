import { command, flag, summary } from 'paparam'
import { persistent } from 'bare-storage'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import pkg from './package.json'
import tty from 'bare-tty'
import App from './app.js'
import UI from './lib/ui.js'

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

const cmd = command(
  appName,
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--storage <dir>', 'custom storage directory'),
  flag('--no-updates', 'disable OTA updates for this run')
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

const app = new App({
  dir,
  app: isDev ? null : os.execPath(),
  updates,
  version: pkg.version,
  upgrade: pkg.upgrade,
  name: isWindows ? appName + '.exe' : appName
})

let ui = null

// the TUI owns the screen, so updater events go to its status line
// instead of stdout — a stray console.log would corrupt the board
const status = (text) => ui?.setStatus(text)

app.on('updating', () => status('actualización encontrada, descargando…'))
app.on('updating-delta', (delta) => status(`actualizando: ${delta}`))
app.on('updated', () => status('actualización descargada, aplicando…'))
app.on('update-applied', () => status('nueva versión lista — reiniciá para jugarla'))
app.on('error', (err) => status(`error: ${err.message}`))

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

  ui = new UI({ version: pkg.version })
  ui.onclose = () => shutdown(0)
  ui.render()
} catch (err) {
  console.error('[app:error]', err)
  await app.close().finally(() => Bare.exit(1))
}
