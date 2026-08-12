#!/usr/bin/env sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP_ID="io.github.rodolfoaltenrath.photo-axia"
MANIFEST="${APP_ID}.yml"
REPO_DIR="repo"
BUNDLE="dist/flatpak/Axia.flatpak"
NODE_VERSION="${NODE_VERSION:-24.14.1}"
NODE_BIN="${NODE_BIN:-${PROJECT_DIR}/.toolchains/node-v${NODE_VERSION}-linux-x64/bin}"
GO_VERSION="${GO_VERSION:-1.23.12}"
GO_BIN="${GO_BIN:-${PROJECT_DIR}/.toolchains/go${GO_VERSION}/bin}"

cd "${PROJECT_DIR}"

if ! command -v flatpak >/dev/null 2>&1; then
  echo "Flatpak não encontrado. Instale o pacote flatpak da sua distribuição." >&2
  exit 1
fi

if [ ! -x "${NODE_BIN}/npm" ]; then
  ./scripts/setup-node.sh
fi

if [ ! -x "${GO_BIN}/go" ]; then
  ./scripts/setup-go.sh
fi

flatpak remote-add --user --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo

flatpak install --user -y flathub \
  org.gnome.Sdk//50 \
  org.freedesktop.Sdk.Extension.golang//25.08 \
  org.flatpak.Builder

PATH="${NODE_BIN}:${PATH}" npm --prefix frontend ci
PATH="${NODE_BIN}:${PATH}" npm --prefix frontend run build
PATH="${GO_BIN}:${PATH}" go mod vendor

mkdir -p "dist/flatpak"

flatpak run --command=flathub-build org.flatpak.Builder \
  --default-branch=stable \
  --install \
  "${MANIFEST}"

flatpak build-update-repo --generate-static-deltas "${REPO_DIR}"
flatpak build-bundle \
  "${REPO_DIR}" \
  "${BUNDLE}" \
  "${APP_ID}" \
  stable \
  --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo

printf '\nFlatpak instalado e pacote gerado em:\n%s\n\nExecute com:\nflatpak run %s\n' \
  "${PROJECT_DIR}/${BUNDLE}" \
  "${APP_ID}"
