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

# --- 1. BINANCE CREDENTIALS ---
echo ""
echo "--- Binance Configuration ---"
echo "Please enter your Binance API credentials:"
read -p "🔐 Binance API Key: " BINANCE_API_KEY
echo ""
read -s -p "🔐 Binance API Secret: " BINANCE_API_SECRET
echo ""

if [ -n "$BINANCE_API_KEY" ] && [ -n "$BINANCE_API_SECRET" ]; then
    echo "🔒 Encrypting Binance credentials..."
    echo -n "$BINANCE_API_KEY" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/binance_api_key.enc
    echo -n "$BINANCE_API_SECRET" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/binance_api_secret.enc
else
    echo "⚠️ Skipping Binance updates (empty input)"
fi

# --- 2. AWS S3 CREDENTIALS ---
echo ""
echo "--- AWS S3 Analytics Configuration ---"
read -p "Enable S3 analytics upload? (y/N): " enable_s3
if [[ "$enable_s3" =~ ^[Yy]$ ]]; then
    read -p "📦 S3 Bucket Name: " S3_BUCKET_NAME
    read -p "🌎 AWS Region: " AWS_REGION
    read -p "🔑 AWS Access Key ID: " AWS_ACCESS_KEY_ID
    echo ""
    read -s -p "🔑 AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
    echo ""
    
    # Optional Signal Bucket
    read -p "Use separate bucket for signal logs? (y/N): " use_separate_signal_bucket
    if [[ "$use_separate_signal_bucket" =~ ^[Yy]$ ]]; then
        read -p "📦 S3 Signal Log Bucket Name: " S3_SIGNAL_LOG_BUCKET_NAME
    fi

    if [ -n "$S3_BUCKET_NAME" ] && [ -n "$AWS_ACCESS_KEY_ID" ]; then
        echo "🔒 Encrypting AWS credentials..."
        echo -n "$S3_BUCKET_NAME" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/s3_bucket_name.enc
        echo -n "$AWS_REGION" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_region.enc
        echo -n "$AWS_ACCESS_KEY_ID" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_access_key_id.enc
        echo -n "$AWS_SECRET_ACCESS_KEY" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_secret_access_key.enc
        
        if [ -n "$S3_SIGNAL_LOG_BUCKET_NAME" ]; then
            echo -n "$S3_SIGNAL_LOG_BUCKET_NAME" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/s3_signal_log_bucket_name.enc
        fi
    fi
fi

# --- 3. EMAIL NOTIFICATIONS (NEW) ---
echo ""
echo "--- Email Notification Configuration ---"
read -p "Enable Email Notifications? (y/N): " enable_email
if [[ "$enable_email" =~ ^[Yy]$ ]]; then
    echo "Please enter your SMTP credentials (e.g., Gmail App Password):"
    read -p "📧 Email User (sender@gmail.com): " EMAIL_USER
    echo ""
    read -s -p "🔑 Email Password (App Password): " EMAIL_PASS
    echo ""
    read -p "📩 Default Recipient (me@gmail.com): " EMAIL_TO

    if [ -n "$EMAIL_USER" ] && [ -n "$EMAIL_PASS" ]; then
        echo "🔒 Encrypting Email credentials..."
        echo -n "$EMAIL_USER" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/email_user.enc
        echo -n "$EMAIL_PASS" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/email_pass.enc
        # Default recipient is optional, uses sender if blank
        if [ -n "$EMAIL_TO" ]; then
            echo -n "$EMAIL_TO" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/email_to.enc
        fi
    else
        echo "❌ Email fields empty, skipping."
    fi
fi

# Set secure permissions
chmod 600 $SECRETS_DIR/*
echo ""
echo "✅ All secrets encrypted and stored successfully."