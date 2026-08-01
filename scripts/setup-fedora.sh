#!/usr/bin/env sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ ! -r /etc/os-release ] || ! grep -q '^ID=fedora$' /etc/os-release; then
  echo "Este instalador e exclusivo para Fedora." >&2
  exit 1
fi

echo "Instalando dependencias nativas do Wails..."
sudo dnf install -y \
  gcc-c++ \
  gtk3-devel \
  pkgconf-pkg-config \
  webkit2gtk4.1-devel

cd "${PROJECT_DIR}"
./scripts/setup-go.sh
./scripts/setup-node.sh
./scripts/frontend-install.sh

echo
echo "Ambiente pronto. Execute ./scripts/wails-dev.sh para iniciar o Axia."
