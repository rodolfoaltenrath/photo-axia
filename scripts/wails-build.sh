#!/usr/bin/env sh
set -eu

NODE_VERSION="${NODE_VERSION:-24.14.1}"
NODE_BIN="${NODE_BIN:-$PWD/.toolchains/node-v${NODE_VERSION}-linux-x64/bin}"
GO_VERSION="${GO_VERSION:-1.23.12}"
GO_BIN="${GO_BIN:-$PWD/.toolchains/go${GO_VERSION}/bin}"
WAILS_BIN="${WAILS_BIN:-$PWD/.toolchains/bin/wails}"

if [ ! -x "${NODE_BIN}/npm" ]; then
  ./scripts/setup-node.sh
fi

if [ ! -x "${GO_BIN}/go" ] || [ ! -x "${WAILS_BIN}" ]; then
  ./scripts/setup-go.sh
fi

PATH="${GO_BIN}:${NODE_BIN}:$PATH" exec "${WAILS_BIN}" build -tags webkit2_41 "$@"
