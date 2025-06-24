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

# Set secure permissions
chmod 600 $SECRETS_DIR/*

echo "✅ API keys encrypted and stored successfully"