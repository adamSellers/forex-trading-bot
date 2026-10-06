#!/bin/bash
# Load the production Node.js runtime before using node/npm/pm2.
#
# The Pi has a broken 32-bit /usr/bin/node package installed alongside the
# working nvm runtime. Non-interactive deploy shells do not load nvm, so be
# explicit here and keep deploy/restart commands away from /usr/bin/node.

# Adam's project policy forbids Python, including native-install fallback.
# node-gyp honors this forced command without probing Python interpreters.
# Prebuilt native Node modules remain usable; source compilation fails closed.
export NODE_GYP_FORCE_PYTHON=/usr/bin/false

if [ -n "${FOREX_NODE_RUNTIME_LOADED:-}" ]; then
    return 0 2>/dev/null || exit 0
fi

export FOREX_NODE_RUNTIME_LOADED=1

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NPM_GLOBAL_BIN="${NPM_GLOBAL_BIN:-$HOME/.npm-global/bin}"
FOREX_NODE_VERSION="${FOREX_NODE_VERSION:-v22.16.0}"
NODE_BIN_DIR=""

if [ -d "$NVM_DIR/versions/node/$FOREX_NODE_VERSION/bin" ]; then
    NODE_BIN_DIR="$NVM_DIR/versions/node/$FOREX_NODE_VERSION/bin"
elif [ -d "$NVM_DIR/versions/node" ]; then
    NODE_BIN_DIR=$(
        find "$NVM_DIR/versions/node" -mindepth 1 -maxdepth 1 -type d 2>/dev/null |
            sort -V |
            tail -n 1
    )
    if [ -n "$NODE_BIN_DIR" ]; then
        NODE_BIN_DIR="$NODE_BIN_DIR/bin"
    fi
fi

if [ -n "$NODE_BIN_DIR" ] && [ -d "$NODE_BIN_DIR" ]; then
    export PATH="$NODE_BIN_DIR:$PATH"
fi

if [ -d "$NPM_GLOBAL_BIN" ]; then
    export PATH="$NPM_GLOBAL_BIN:$PATH"
fi

if ! NODE_VERSION_OUTPUT=$(node -v 2>/dev/null); then
    echo "❌ Node.js runtime is unavailable or crashing. Check nvm at $NVM_DIR." >&2
    return 1 2>/dev/null || exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ] || [ "$NODE_MAJOR" -ge 23 ]; then
    echo "❌ Unsupported Node.js runtime $NODE_VERSION_OUTPUT. Install the pinned version from .nvmrc (v22.16.0)." >&2
    return 1 2>/dev/null || exit 1
fi

if [ "$(uname -m 2>/dev/null)" = "aarch64" ]; then
    NODE_ARCH=$(node -p "process.arch" 2>/dev/null || true)
    if [ "$NODE_ARCH" != "arm64" ]; then
        echo "❌ Refusing to use non-arm64 Node ($NODE_VERSION_OUTPUT, arch: ${NODE_ARCH:-unknown}) on aarch64 host." >&2
        return 1 2>/dev/null || exit 1
    fi
fi
