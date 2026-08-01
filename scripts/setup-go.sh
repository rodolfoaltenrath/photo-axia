#!/usr/bin/env sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GO_VERSION="${GO_VERSION:-1.23.12}"
WAILS_VERSION="${WAILS_VERSION:-v2.12.0}"
TOOLCHAIN_DIR="${PROJECT_DIR}/.toolchains"

case "$(uname -m)" in
  x86_64) GO_ARCH="amd64" ;;
  aarch64) GO_ARCH="arm64" ;;
  *) echo "Arquitetura nao suportada: $(uname -m)" >&2; exit 1 ;;
esac

GO_DIR="${TOOLCHAIN_DIR}/go${GO_VERSION}"
GO_BIN="${GO_DIR}/bin"
WAILS_BIN="${TOOLCHAIN_DIR}/bin/wails"

if [ ! -x "${GO_BIN}/go" ]; then
  if [ -e "${GO_DIR}" ]; then
    echo "Instalacao parcial encontrada em ${GO_DIR}. Remova-a e execute novamente." >&2
    exit 1
  fi

  TEMP_DIR=$(mktemp -d)
  trap 'rm -rf "${TEMP_DIR}"' EXIT HUP INT TERM
  ARCHIVE="go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"

  mkdir -p "${TOOLCHAIN_DIR}"
  echo "Baixando Go ${GO_VERSION}..."
  curl -fsSL "https://go.dev/dl/${ARCHIVE}" -o "${TEMP_DIR}/${ARCHIVE}"
  tar -xzf "${TEMP_DIR}/${ARCHIVE}" -C "${TEMP_DIR}"
  mv "${TEMP_DIR}/go" "${GO_DIR}"
fi

mkdir -p "${TOOLCHAIN_DIR}/bin"
if [ ! -x "${WAILS_BIN}" ]; then
  echo "Instalando Wails ${WAILS_VERSION}..."
  GOBIN="${TOOLCHAIN_DIR}/bin" "${GO_BIN}/go" install "github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}"
fi

"${GO_BIN}/go" version
"${WAILS_BIN}" version
