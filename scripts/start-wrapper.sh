#!/bin/bash
set -e

# This script decrypts secrets and starts the Node.js server.
# It's intended to be called by PM2.

# --- Configuration ---
BASE_DIR="/opt/crypto-trading-bot"
SECRETS_DIR="$BASE_DIR/.secrets"
KEYS_DIR="$BASE_DIR/.keys"
ENCRYPTION_KEY_FILE="$KEYS_DIR/encryption.key"

# Binance Keys
API_KEY_FILE="$SECRETS_DIR/binance_api_key.enc"
API_SECRET_FILE="$SECRETS_DIR/binance_api_secret.enc"

# AWS S3 Keys
S3_BUCKET_FILE="$SECRETS_DIR/s3_bucket_name.enc"
AWS_REGION_FILE="$SECRETS_DIR/aws_region.enc"
AWS_KEY_ID_FILE="$SECRETS_DIR/aws_access_key_id.enc"
AWS_SECRET_KEY_FILE="$SECRETS_DIR/aws_secret_access_key.enc"
S3_SIGNAL_LOG_BUCKET_FILE="$SECRETS_DIR/s3_signal_log_bucket_name.enc"

# NEW: Email Credentials
EMAIL_USER_FILE="$SECRETS_DIR/email_user.enc"
EMAIL_PASS_FILE="$SECRETS_DIR/email_pass.enc"
EMAIL_TO_FILE="$SECRETS_DIR/email_to.enc"

# --- Decrypt and Export ---
if [ -f "$ENCRYPTION_KEY_FILE" ]; then
    # Read the encryption key
    ENCRYPTION_KEY=$(cat "$ENCRYPTION_KEY_FILE")

    # 1. Decrypt Binance Credentials
    if [ -f "$API_KEY_FILE" ]; then
        export BINANCE_API_KEY=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$API_KEY_FILE" 2>/dev/null)
        export BINANCE_API_SECRET=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$API_SECRET_FILE" 2>/dev/null)
    fi

    # 2. Decrypt AWS S3 Credentials
    if [ -f "$S3_BUCKET_FILE" ]; then
        export ENABLE_S3_ANALYTICS="true"
        export ENABLE_S3_SIGNAL_LOGGING="true" 

        export S3_BUCKET_NAME=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$S3_BUCKET_FILE" 2>/dev/null)
        export AWS_REGION=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$AWS_REGION_FILE" 2>/dev/null)
        export AWS_ACCESS_KEY_ID=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$AWS_KEY_ID_FILE" 2>/dev/null)
        export AWS_SECRET_ACCESS_KEY=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$AWS_SECRET_KEY_FILE" 2>/dev/null)
        if [ -f "$S3_SIGNAL_LOG_BUCKET_FILE" ]; then
            export S3_SIGNAL_LOG_BUCKET_NAME=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$S3_SIGNAL_LOG_BUCKET_FILE" 2>/dev/null)
        fi
    else
        export ENABLE_S3_ANALYTICS="false"
        export ENABLE_S3_SIGNAL_LOGGING="false"
    fi

    # 3. NEW: Decrypt Email Credentials
    if [ -f "$EMAIL_USER_FILE" ]; then
        export EMAIL_USER=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$EMAIL_USER_FILE" 2>/dev/null)
        export EMAIL_PASS=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$EMAIL_PASS_FILE" 2>/dev/null)
        
        # Optional default recipient
        if [ -f "$EMAIL_TO_FILE" ]; then
            export EMAIL_TO=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$EMAIL_TO_FILE" 2>/dev/null)
        fi
    fi

    echo "✅ Secrets decrypted and loaded into environment." >&2
fi

# --- Start the Node.js Application ---
# PM2 sets the CWD, so we just need to execute the server script.
exec node server.js