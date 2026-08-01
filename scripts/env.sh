#!/usr/bin/env bash

AXIA_PROJECT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export PATH="${AXIA_PROJECT_DIR}/.toolchains/go1.23.12/bin:${AXIA_PROJECT_DIR}/.toolchains/node-v24.14.1-linux-x64/bin:${AXIA_PROJECT_DIR}/.toolchains/bin:${PATH}"
unset AXIA_PROJECT_DIR
