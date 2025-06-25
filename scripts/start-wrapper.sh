#!/bin/bash
set -e

# This script decrypts secrets and starts the Node.js server.
# It's intended to be called by PM2.

# --- Configuration ---
BASE_DIR="/opt/crypto-trading-bot"
SECRETS_DIR="$BASE_DIR/.secrets"
KEYS_DIR="$BASE_DIR/.keys"
ENCRYPTION_KEY_FILE="$KEYS_DIR/encryption.key"
API_KEY_FILE="$SECRETS_DIR/binance_api_key.enc"
API_SECRET_FILE="$SECRETS_DIR/binance_api_secret.enc"

# --- Decrypt and Export ---
if [ -f "$ENCRYPTION_KEY_FILE" ] && [ -f "$API_KEY_FILE" ] && [ -f "$API_SECRET_FILE" ]; then
    # Read the encryption key
    ENCRYPTION_KEY=$(cat "$ENCRYPTION_KEY_FILE")

    # Decrypt the API key and secret and export them as environment variables
    export BINANCE_API_KEY=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$API_KEY_FILE" 2>/dev/null)
    export BINANCE_API_SECRET=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$API_SECRET_FILE" 2>/dev/null)

    echo "✅ Secrets decrypted and loaded into environment." >&2
fi

# --- Start the Node.js Application ---
# PM2 sets the CWD, so we just need to execute the server script.
exec node server.js