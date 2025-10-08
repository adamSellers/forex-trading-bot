#!/bin/bash
set -e

SECRETS_DIR="/opt/crypto-trading-bot/.secrets"
KEYS_DIR="/opt/crypto-trading-bot/.keys"

echo "🔐 Setting up secure API key management..."

# Create secure directories
mkdir -p $SECRETS_DIR $KEYS_DIR
chmod 700 $SECRETS_DIR $KEYS_DIR

# Generate encryption key if it doesn't exist
if [ ! -f "$KEYS_DIR/encryption.key" ]; then
    echo "🔑 Generating encryption key..."
    openssl rand -hex 32 > $KEYS_DIR/encryption.key
    chmod 600 $KEYS_DIR/encryption.key
    echo "✅ Encryption key generated"
else
    echo "✅ Using existing encryption key"
fi

# Get API credentials
echo ""
echo "Please enter your Binance API credentials:"
read -p "🔐 Binance API Key: " BINANCE_API_KEY
echo ""
read -s -p "🔐 Binance API Secret: " BINANCE_API_SECRET
echo ""

# Validate inputs
if [ -z "$BINANCE_API_KEY" ] || [ -z "$BINANCE_API_SECRET" ]; then
    echo "❌ API key and secret cannot be empty"
    exit 1
fi

# Encrypt and store credentials
echo "🔒 Encrypting and storing API credentials..."
echo -n "$BINANCE_API_KEY" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/binance_api_key.enc
echo -n "$BINANCE_API_SECRET" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/binance_api_secret.enc

# NEW: Conditionally get AWS S3 credentials
echo ""
read -p "Do you want to enable analytics upload to an AWS S3 bucket? (y/N): " enable_s3
if [[ "$enable_s3" =~ ^[Yy]$ ]]; then
    echo ""
    echo "Please enter your AWS S3 credentials for analytics upload:"
    read -p "📦 S3 Bucket Name (for performance reports): " S3_BUCKET_NAME
    read -p "🌎 AWS Region (e.g., us-east-1): " AWS_REGION
    read -p "🔑 AWS Access Key ID: " AWS_ACCESS_KEY_ID
    echo ""
    read -s -p "🔑 AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
    echo ""

    # NEW: Ask for a separate, optional bucket for signal logs
    read -p "Do you want to use a separate bucket for signal logs? (y/N): " use_separate_signal_bucket
    if [[ "$use_separate_signal_bucket" =~ ^[Yy]$ ]]; then
        read -p "📦 S3 Signal Log Bucket Name: " S3_SIGNAL_LOG_BUCKET_NAME
    fi

    # Validate AWS inputs
    if [ -z "$S3_BUCKET_NAME" ] || [ -z "$AWS_REGION" ] || [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
        echo "❌ All AWS S3 fields are required. S3 upload will be disabled."
    else
        echo "🔒 Encrypting and storing AWS S3 credentials..."
        echo -n "$S3_BUCKET_NAME" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/s3_bucket_name.enc
        if [ -n "$S3_SIGNAL_LOG_BUCKET_NAME" ]; then
            echo -n "$S3_SIGNAL_LOG_BUCKET_NAME" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/s3_signal_log_bucket_name.enc
        fi
        echo -n "$AWS_REGION" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_region.enc
        echo -n "$AWS_ACCESS_KEY_ID" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_access_key_id.enc
        echo -n "$AWS_SECRET_ACCESS_KEY" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_secret_access_key.enc
    fi
else
    echo "ℹ️  S3 analytics upload will be disabled."
fi

# Set secure permissions
chmod 600 $SECRETS_DIR/*

echo "✅ API keys encrypted and stored successfully"