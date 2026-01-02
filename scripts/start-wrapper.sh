#!/bin/bash
set -e

# =====================================================
# Forex Trading Bot - Start Wrapper
# Decrypts secrets and starts the Node.js server
# Called by PM2 via ecosystem.config.js
# =====================================================

# --- Configuration ---
BASE_DIR="/opt/forex-trading-bot"
SECRETS_DIR="$BASE_DIR/.secrets"
KEYS_DIR="$BASE_DIR/.keys"
ENCRYPTION_KEY_FILE="$KEYS_DIR/encryption.key"

# Oanda Credentials
OANDA_API_KEY_FILE="$SECRETS_DIR/oanda_api_key.enc"
OANDA_ACCOUNT_ID_FILE="$SECRETS_DIR/oanda_account_id.enc"
OANDA_ENVIRONMENT_FILE="$SECRETS_DIR/oanda_environment.enc"

# Email Credentials (Optional)
EMAIL_USER_FILE="$SECRETS_DIR/email_user.enc"
EMAIL_PASS_FILE="$SECRETS_DIR/email_pass.enc"
EMAIL_TO_FILE="$SECRETS_DIR/email_to.enc"

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

    # 2. Decrypt Email Credentials (Optional)
    if [ -f "$EMAIL_USER_FILE" ]; then
        export EMAIL_USER=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$EMAIL_USER_FILE" 2>/dev/null)
        export EMAIL_PASS=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$EMAIL_PASS_FILE" 2>/dev/null)
        
        if [ -f "$EMAIL_TO_FILE" ]; then
            export EMAIL_TO=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$EMAIL_TO_FILE" 2>/dev/null)
        fi
    fi

    echo "✅ Secrets decrypted and loaded into environment." >&2
else
    echo "⚠️  Encryption key not found - running without secrets" >&2
fi

# --- Start the Node.js Application ---
# PM2 sets the CWD via ecosystem.config.js, so we just execute server.js
exec node server.js