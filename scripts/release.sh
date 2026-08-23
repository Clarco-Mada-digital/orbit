#!/usr/bin/env sh
# Publication locale d'une release Orbit depuis Linux.
#
# Demande le token GitHub (saisie masquée) puis lance :
#   icônes → build Vite → electron-builder --linux AppImage --publish always
#
# Le token doit avoir le scope « repo » :
#   GitHub → Settings → Developer settings → Personal access tokens
#
# Usage : ./scripts/release.sh

set -e
cd "$(dirname "$0")/.."

if [ -n "$GH_TOKEN" ]; then
  echo "✓ GH_TOKEN déjà défini dans l'environnement."
else
  printf "Token GitHub (scope repo, saisie masquée) : "
  # -s : silencieux (masque la saisie), puis on simule Entrée
  stty -echo 2>/dev/null || true
  IFS= read -r GH_TOKEN
  stty echo 2>/dev/null || true
  printf "\n"
  if [ -z "$GH_TOKEN" ]; then
    echo "✗ Aucun token fourni — publication annulée." >&2
    exit 1
  fi
  export GH_TOKEN
fi

echo "→ Génération des icônes…"
npm run icons

echo "→ Build du front…"
npm run build

echo "→ Packaging + publication sur GitHub Releases…"
npx electron-builder --linux AppImage deb --publish always

echo "✓ Terminé. Release publiée : https://github.com/Clarco-Mada-digital/orbit/releases"
