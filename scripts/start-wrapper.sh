#!/bin/bash
set -e

# =====================================================
# Forex Trading Bot - Start Wrapper
# Decrypts secrets and starts the Node.js server
# Called by PM2 via ecosystem.config.js
# =====================================================

# --- Detect Project Root Dynamically ---
# This script is in scripts/, so go up one level to get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Configuration ---
SECRETS_DIR="$BASE_DIR/.secrets"
KEYS_DIR="$BASE_DIR/.keys"
ENCRYPTION_KEY_FILE="$KEYS_DIR/encryption.key"

# Oanda Credentials
OANDA_API_KEY_FILE="$SECRETS_DIR/oanda_api_key.enc"
OANDA_ACCOUNT_ID_FILE="$SECRETS_DIR/oanda_account_id.enc"
OANDA_ENVIRONMENT_FILE="$SECRETS_DIR/oanda_environment.enc"

# Slack Webhook (Optional)
SLACK_WEBHOOK_URL_FILE="$SECRETS_DIR/slack_webhook_url.enc"

# --- Decrypt and Export ---
if [ -f "$ENCRYPTION_KEY_FILE" ]; then
    ENCRYPTION_KEY=$(cat "$ENCRYPTION_KEY_FILE")

    # 1. Decrypt Oanda Credentials
    if [ -f "$OANDA_API_KEY_FILE" ]; then
        export OANDA_API_KEY=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$OANDA_API_KEY_FILE" 2>/dev/null)
    fi

    if [ -f "$OANDA_ACCOUNT_ID_FILE" ]; then
        export OANDA_ACCOUNT_ID=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$OANDA_ACCOUNT_ID_FILE" 2>/dev/null)
    fi

    if [ -f "$OANDA_ENVIRONMENT_FILE" ]; then
        export OANDA_ENVIRONMENT=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$OANDA_ENVIRONMENT_FILE" 2>/dev/null)
    else
        export OANDA_ENVIRONMENT="live"
    fi

    # 2. Decrypt Slack Webhook URL (Optional)
    if [ -f "$SLACK_WEBHOOK_URL_FILE" ]; then
        export SLACK_WEBHOOK_URL=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$SLACK_WEBHOOK_URL_FILE" 2>/dev/null)
    fi

    echo "✅ Secrets decrypted and loaded into environment." >&2
else
    echo "⚠️  Encryption key not found - running without secrets" >&2
fi

# --- Start the Node.js Application ---
# PM2 sets the CWD via ecosystem.config.js, so we just execute server.js
exec node server.js