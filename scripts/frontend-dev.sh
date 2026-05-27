#!/usr/bin/env sh
set -eu

NODE_VERSION="${NODE_VERSION:-24.14.1}"
NODE_BIN="${NODE_BIN:-$PWD/.toolchains/node-v${NODE_VERSION}-linux-x64/bin}"

if [ ! -x "${NODE_BIN}/npm" ]; then
  ./scripts/setup-node.sh
fi

cd frontend
PATH="${NODE_BIN}:$PATH" npm run dev

