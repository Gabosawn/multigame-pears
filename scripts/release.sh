#!/bin/bash
# Arma el deployment y lo publica.
#
#   ./scripts/release.sh              # dry-run: muestra el delta, no publica
#   ./scripts/release.sh --publish    # publica de verdad
#
# Tres cosas que este script existe para que no se olviden:
#
#   1. El CHANGELOG.md tiene que copiarse al deployment a mano. `pear build` no
#      lo hace, y sin el `pear changelog pear://<key>` devuelve "No Changelog" —
#      que es el mecanismo nativo de Pear para distribuir release notes P2P.
#   2. El updater compara el campo `version` de package.json. Sin bump, la copia
#      instalada no se actualiza nunca y parece que el OTA esta roto.
#   3. El dry-run va siempre primero. Un stage sube ~473 MB y no se deshace.
set -eu

cd "$(dirname "$0")/.."

LINK=$(node -p "require('./package.json').upgrade")
VERSION=$(node -p "require('./package.json').version")
PUBLISH=${1:-}

echo "proyecto : $LINK"
echo "version  : $VERSION"
echo

for host in linux-x64 linux-arm64 darwin-arm64 darwin-x64 win32-x64 win32-arm64; do
  ext=""
  case "$host" in win32-*) ext=".exe" ;; esac
  if [ ! -f "out/$host/multigame-pears$ext" ]; then
    echo "falta out/$host/multigame-pears$ext — corre npm run make:$host"
    exit 1
  fi
done

echo "=== pear build ==="
rm -rf deployment
pear build \
  --package package.json \
  --linux-x64-app out/linux-x64/multigame-pears \
  --linux-arm64-app out/linux-arm64/multigame-pears \
  --darwin-arm64-app out/darwin-arm64/multigame-pears \
  --darwin-x64-app out/darwin-x64/multigame-pears \
  --win32-x64-app out/win32-x64/multigame-pears.exe \
  --win32-arm64-app out/win32-arm64/multigame-pears.exe \
  --target deployment

# pear build no copia el changelog: sin esto, `pear changelog` del link queda vacio
cp CHANGELOG.md deployment/CHANGELOG.md
echo "changelog copiado al deployment"

if [ "$PUBLISH" != "--publish" ]; then
  echo
  echo "=== pear stage --dry-run (no publica nada) ==="
  pear stage --dry-run "$LINK" ./deployment
  echo
  echo "Para publicar de verdad:  ./scripts/release.sh --publish"
  exit 0
fi

echo
echo "=== pear stage ==="
pear stage "$LINK" ./deployment

echo
echo "=== verificacion ==="
pear info "$LINK" | head -12
node scripts/check-seed.js "$(pear info "$LINK" --json 2>/dev/null | node -e '
  let s = ""
  process.stdin.on("data", (d) => (s += d))
  process.stdin.on("end", () => {
    for (const line of s.split("\n")) {
      try {
        const j = JSON.parse(line)
        if (j?.data?.discovery) return console.log(j.data.discovery)
      } catch {}
    }
  })
')" || echo "revisa el seeding: npm run seed"
