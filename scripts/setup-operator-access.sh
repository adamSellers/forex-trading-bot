#!/bin/bash
set -Eeuo pipefail
set +x
umask 077

project="${FOREX_PROJECT_DIR:-/opt/forex-trading-bot}"
secret="$project/.secrets/operator_token.enc"
key="$project/.keys/encryption.key"
access_file="$project/.keys/operator-access-token.txt"
if [ -f "$secret" ] && [ "${1:-}" != "--rotate" ]; then
    echo "Operator access already exists. Use --rotate only for deliberate rotation; restart invalidates existing sessions."
    exit 1
fi
case "${1:-}" in ''|--rotate) ;; *) echo "Usage: $0 [--rotate]" >&2; exit 1 ;; esac
mkdir -p "$project/.keys" "$project/.secrets"
chmod 700 "$project/.keys" "$project/.secrets"
if [ ! -f "$key" ]; then
    if [ -n "$(find "$project/.secrets" -maxdepth 1 -type f -name '*.enc' -print -quit)" ]; then
        echo "Existing encrypted credentials have no key. Recover the original encryption key before provisioning." >&2
        exit 1
    fi
    openssl rand -hex 32 > "$key"
fi
chmod 600 "$key"
temporary=$(mktemp "$project/.secrets/.operator-token.XXXXXX")
plain=$(mktemp "$project/.keys/.operator-access.XXXXXX")
trap 'rm -f "$temporary" "$plain"' EXIT
openssl rand -hex 32 > "$plain"
openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt \
    -pass "file:$key" -in "$plain" -out "$temporary"
chmod 600 "$temporary" "$plain"
mv "$temporary" "$secret"
mv "$plain" "$access_file"
echo "Operator credential provisioned. The token was not printed."
echo "Read the owner-only access file when signing in: $access_file"
echo "Keep an independently secured recovery copy of the encryption key and credentials."
echo "An existing process picks up a rotated token only after a reviewed, paused/flat restart."
