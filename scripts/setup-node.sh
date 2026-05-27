#!/usr/bin/env sh
set -eu

NODE_VERSION="${NODE_VERSION:-24.14.1}"
NODE_DIST="node-v${NODE_VERSION}-linux-x64"
TOOLCHAIN_DIR=".toolchains"
NODE_DIR="${TOOLCHAIN_DIR}/${NODE_DIST}"
NODE_ARCHIVE="${NODE_DIST}.tar.xz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"

if [ ! -x "${NODE_DIR}/bin/node" ]; then
  mkdir -p "$TOOLCHAIN_DIR"
  echo "Downloading Node.js v${NODE_VERSION}..."
  curl -L "$NODE_URL" | tar -xJ -C "$TOOLCHAIN_DIR"
fi

PATH="${NODE_DIR}/bin:$PATH"
node --version
npm --version

