'use strict'

// Formato y firma de un registro de contenido.
//
// Vive aparte de lib/content.js a proposito: ese usa bare-fs y solo corre en
// Bare, mientras que el CLI del autor corre en node. Las dos puntas tienen que
// firmar y verificar EXACTAMENTE igual, asi que la logica esta una sola vez y
// no depende de nada especifico del runtime — hypercore-crypto y b4a andan en
// los dos.

const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const MAX_RECORD_BYTES = 4096

// El orden de las claves entra en la firma, asi que la serializacion tiene que
// ser canonica: un array posicional en vez de un objeto, porque el orden de
// claves de un objeto JSON no esta garantizado entre runtimes.
function canonical(kind, id, data) {
  return b4a.from(JSON.stringify([kind, id, data]))
}

function recordId(kind, data) {
  const digest = crypto.data(b4a.from(JSON.stringify([kind, data])))
  return b4a.toString(digest, 'hex').slice(0, 32)
}

function sign(kind, data, secretKey) {
  const id = recordId(kind, data)
  const sig = crypto.sign(canonical(kind, id, data), secretKey)
  return { kind, id, data, sig: b4a.toString(sig, 'hex') }
}

function verify(record, authorKey) {
  if (authorKey === null || record === null || typeof record !== 'object') return false
  if (typeof record.kind !== 'string' || typeof record.id !== 'string') return false
  if (typeof record.sig !== 'string' || record.data === undefined) return false
  if (JSON.stringify(record).length > MAX_RECORD_BYTES) return false
  if (recordId(record.kind, record.data) !== record.id) return false

  let sig = null
  try {
    sig = b4a.from(record.sig, 'hex')
  } catch {
    return false
  }
  if (sig.byteLength !== 64) return false

  return crypto.verify(canonical(record.kind, record.id, record.data), sig, authorKey)
}

module.exports = { canonical, recordId, sign, verify, MAX_RECORD_BYTES }
