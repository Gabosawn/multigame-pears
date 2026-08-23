#!/bin/bash
# Mantiene vivo el anuncio del link en la DHT — lo que decide si alguien puede
# instalar la app. Si el anuncio se cae, `pear seed` no se da cuenta: sigue
# corriendo e imprimiendo "announced" mientras nadie puede instalar nada.
#
#   ./scripts/seed-guard.sh <pear-link> <discovery-key> [intervalo-segundos]
#
# Cuatro cosas que aprendimos a la mala:
#
#   1. Reiniciar el seed cuesta ~15s con CERO seeders. Un tick corto con
#      reinicio inmediato empeora la disponibilidad en vez de mejorarla. Por eso
#      una caida se confirma con un segundo chequeo antes de tocar nada.
#   2. Matar por `comm` mata TODO proceso llamado `pear` — incluido un
#      `pear stage` en vuelo, justo cuando estas publicando una release. Aca
#      solo se matan los pids que lanzo este guardian.
#   3. "No pude verificar" (sin red, timeout del lookup) no es lo mismo que
#      "esta caido". check-seed.js sale con 2 en ese caso y no se reinicia nada.
#   4. Si al arrancar ya hay un seed sano, se adopta en vez de reiniciarlo: el
#      relevo entre guardianes no tiene por que costar downtime.
set -u

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LINK="${1:?falta el link pear://}"
DISCOVERY="${2:?falta la discovery key (pear info pear://<link>)}"
INTERVAL="${3:-30}"

CONFIRM_DELAY=5      # espera antes de re-chequear una caida
RECOVER_TIMEOUT=90   # cuanto esperamos que el anuncio vuelva tras un reinicio
RECOVER_POLL=3
SIDECAR_AFTER=3      # reinicios fallidos seguidos antes de patear el sidecar

SEED_LOG="$DIR/seed.log"
GUARD_LOG="$DIR/seed-guard.log"
SEED_PID=""
FAILED_RESTARTS=0

log() { echo "$(date '+%F %T')  $*" >>"$GUARD_LOG"; }

# 0 = anunciado · 1 = caido · 2 = no se pudo verificar
check() {
  node "$DIR/scripts/check-seed.js" "$DISCOVERY" >/dev/null 2>&1
  echo $?
}

# solo nuestro pid: nunca por comm, para no matar un `pear stage` en vuelo
kill_our_seed() {
  [ -n "$SEED_PID" ] || return 0
  kill "$SEED_PID" 2>/dev/null
  for _ in $(seq 10); do
    kill -0 "$SEED_PID" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$SEED_PID" 2>/dev/null
  SEED_PID=""
}

# un pear seed de ESTE link ya corriendo, lanzado por otra corrida del guardian
find_existing_seed() {
  ps -eo pid,args --no-headers |
    awk -v link="$LINK" '$0 ~ /pear seed/ && index($0, link) { print $1; exit }'
}

start_seed() {
  kill_our_seed
  nohup pear seed --no-tty "$LINK" >>"$SEED_LOG" 2>&1 &
  SEED_PID=$!
  log "seed lanzado (pid $SEED_PID)"
}

# espera activa hasta que el anuncio vuelva; 1 si nunca volvio
await_announce() {
  local waited=0
  while [ "$waited" -lt "$RECOVER_TIMEOUT" ]; do
    sleep "$RECOVER_POLL"
    waited=$((waited + RECOVER_POLL))
    if [ "$(check)" = 0 ]; then
      log "recuperado tras ${waited}s"
      return 0
    fi
  done
  return 1
}

restart_and_recover() {
  start_seed
  if await_announce; then
    FAILED_RESTARTS=0
    return
  fi

  FAILED_RESTARTS=$((FAILED_RESTARTS + 1))
  log "SIGUE CAIDO tras reiniciar (fallo #$FAILED_RESTARTS)"

  # el seed depende del sidecar; si reiniciar el seed no alcanza, el problema
  # esta una capa mas abajo
  if [ "$FAILED_RESTARTS" -ge "$SIDECAR_AFTER" ]; then
    log "pateando el sidecar"
    kill_our_seed
    pear sidecar shutdown >/dev/null 2>&1
    sleep 5
    start_seed
    if await_announce; then
      FAILED_RESTARTS=0
    else
      log "NI CON EL SIDECAR — revisar a mano"
    fi
  fi
}

log "=== guardian iniciado · intervalo ${INTERVAL}s ==="

# relevo sin downtime: si ya hay un seed sano corriendo, adoptarlo
EXISTING="$(find_existing_seed)"
if [ -n "$EXISTING" ] && [ "$(check)" = 0 ]; then
  SEED_PID="$EXISTING"
  log "adoptado seed sano ya corriendo (pid $SEED_PID) — sin reinicio"
else
  start_seed
  await_announce || log "el anuncio no subio en el arranque"
fi

while true; do
  sleep "$INTERVAL"

  if ! kill -0 "$SEED_PID" 2>/dev/null; then
    log "el proceso del seed murio — relanzando"
    restart_and_recover
    continue
  fi

  case "$(check)" in
    0)
      log "ok"
      continue
      ;;
    2)
      log "no se pudo verificar — sin reiniciar"
      continue
      ;;
  esac

  # confirmar antes de reiniciar: un lookup fallido no es siempre una caida
  sleep "$CONFIRM_DELAY"
  if [ "$(check)" != 1 ]; then
    log "falso positivo (recupero solo)"
    continue
  fi

  log "ANUNCIO CAIDO (confirmado) — reiniciando seed"
  restart_and_recover
done
