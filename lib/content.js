const fs = require('bare-fs')
const path = require('bare-path')
const b4a = require('b4a')

const record = require('./content-record.js')

// Canal de contenido: arenas y novedades que llegan sin bajar un binario.
//
// Por que existe. El OTA de Pear reemplaza el EJECUTABLE, y el JS de la app va
// bakeado adentro: medimos que un cambio de solo-JS produce un binario que
// difiere en 4.698 bytes de 98 MB, pero el updater usa `drive.mirror`, que
// compara por archivo y no por bloque, asi que transfiere los 98 MB completos.
// Por internet eso son cuatro segundos. Por Bluetooth serian horas.
//
// Asi que hay dos niveles de actualizacion, y conviene no confundirlos:
//
//   1. La APP se actualiza por OTA de Pear. Es el requisito del track,
//      funciona, y es lo que trae codigo nuevo.
//   2. El CONTENIDO viaja por aca: registros JSON de unos cientos de bytes que
//      se propagan de peer a peer por la misma conexion de la partida. Una
//      arena nueva aparece en el menu sin reiniciar nada, y pasa por Bluetooth
//      sin problema.
//
// Por que gossip y no un Hypercore replicado: a esta escala (decenas de
// registros chicos) el gossip son cuarenta lineas y funciona sobre cualquier
// transporte, incluida una conexion BLE, sin multiplexar nada encima del
// protocolo de la partida. Lo que se pierde de Hypercore —verificacion
// criptografica de autoria— se recupera firmando cada registro: la clave PUBLICA
// del autor viaja dentro del binario y todo lo que no venga firmado por ella se
// descarta, asi que un peer malicioso no puede inyectar una arena.

// Clave publica del autor del contenido, en hex. La privada nunca sale de la
// maquina de quien publica. Se genera con `npm run content init`.
const AUTHOR = '9df5e6fb02620b0bf86c08b6053b9b41061c50fa63ad3eeaed52c3e5ef796ff2'

const MAX_RECORDS = 200

module.exports = class Content {
  constructor({ dir, authorKey = AUTHOR }) {
    this.file = path.join(dir, 'content.json')
    this.author = /^[0-9a-f]{64}$/i.test(authorKey) ? b4a.from(authorKey, 'hex') : null
    this.records = new Map() // id -> record, en orden de llegada
    this.played = new Set() // arenas ya estrenadas en esta sesion
    this.onchange = null
  }

  // sin clave de autor configurada el canal queda inerte en vez de aceptar
  // cualquier cosa que llegue por la red
  get enabled() {
    return this.author !== null
  }

  load() {
    this.merge(this._read(this.file), { quiet: true })
    return this
  }

  // registros que el autor inyecta a mano (bandera --content), para publicar sin
  // tener que tocar el storage
  loadFile(file) {
    return this.merge(this._read(file))
  }

  _read(file) {
    let raw = null
    try {
      raw = fs.readFileSync(file)
    } catch {
      return [] // no existe todavia: primera corrida
    }

    try {
      const parsed = JSON.parse(b4a.toString(raw))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return [] // corrupto: arrancar limpio en vez de morir
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.file, b4a.from(JSON.stringify([...this.records.values()])))
    } catch {
      // sin disco el contenido igual funciona en memoria hasta que se cierre
    }
  }

  _accept(entry) {
    if (this.records.size >= MAX_RECORDS) return false
    if (this.records.has(entry?.id)) return false
    if (!record.verify(entry, this.author)) return false
    this.records.set(entry.id, entry)
    return true
  }

  // registros nuevos, de un peer o de un archivo. Devuelve cuantos entraron,
  // para que la UI pueda avisar "llego una arena nueva".
  merge(entries, { quiet = false } = {}) {
    if (!Array.isArray(entries)) return 0
    let added = 0
    for (const entry of entries) if (this._accept(entry)) added += 1
    if (added > 0) {
      this._save()
      if (!quiet && this.onchange) this.onchange(added)
    }
    return added
  }

  ids() {
    return [...this.records.keys()]
  }

  // lo que el peer no tiene. El gossip es simetrico: cada lado manda sus ids y
  // contesta con lo que le falta al otro.
  missing(theirIds) {
    const theirs = new Set(Array.isArray(theirIds) ? theirIds : [])
    const out = []
    for (const [id, entry] of this.records) if (!theirs.has(id)) out.push(entry)
    return out
  }

  arenas() {
    const out = []
    for (const entry of this.records.values()) {
      if (entry.kind !== 'arena') continue
      const arena = entry.data
      if (!arena || typeof arena.id !== 'string') continue
      if (!(arena.w > 0) || !(arena.h > 0)) continue
      out.push(arena)
    }
    return out
  }

  news() {
    const out = []
    for (const entry of this.records.values()) {
      if (entry.kind === 'news') out.push(entry.data)
    }
    return out
  }

  // La arena mas nueva que todavia no se estreno. Existe para que el demo sea
  // el demo: llega una arena por la red y la proxima partida ya se juega ahi,
  // en vez de esperar a que la rotacion pase por ella.
  freshArena() {
    const all = this.arenas()
    for (let i = all.length - 1; i >= 0; i--) {
      if (this.played.has(all[i].id)) continue
      this.played.add(all[i].id)
      return all[i]
    }
    return null
  }
}

module.exports.AUTHOR = AUTHOR
