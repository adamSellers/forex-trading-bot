#!/bin/bash
# scripts/setup-secrets.sh - Forex Trading Bot Secure API Key Management
set -e

SECRETS_DIR="/opt/forex-trading-bot/.secrets"
KEYS_DIR="/opt/forex-trading-bot/.keys"

echo "🔐 Setting up secure API key management for Forex Bot..."

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

# --- 1. OANDA CREDENTIALS ---
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "                   OANDA Configuration"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Your Oanda API key can be found at:"
echo "  https://www.oanda.com/account/login"
echo "  → Manage API Access → Generate Personal Access Token"
echo ""

read -p "🔑 Oanda API Key: " OANDA_API_KEY
echo ""
read -p "📋 Oanda Account ID: " OANDA_ACCOUNT_ID
if [ -z "$OANDA_ACCOUNT_ID" ]; then
    echo "❌ Account ID is required"
    exit 1
fi
echo ""
read -p "🌐 Environment (live/practice) [live]: " OANDA_ENVIRONMENT
OANDA_ENVIRONMENT=${OANDA_ENVIRONMENT:-live}

if [ -n "$OANDA_API_KEY" ]; then
    echo "🔒 Encrypting Oanda credentials..."
    echo -n "$OANDA_API_KEY" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/oanda_api_key.enc
    echo -n "$OANDA_ACCOUNT_ID" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/oanda_account_id.enc
    echo -n "$OANDA_ENVIRONMENT" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/oanda_environment.enc
    echo "✅ Oanda credentials encrypted"
else
    echo "⚠️ Skipping Oanda setup (empty input)"
fi

# --- 2. EMAIL NOTIFICATIONS (Optional) ---
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "           Email Notification Configuration (Optional)"
echo "═══════════════════════════════════════════════════════════"
read -p "Enable Email Notifications? (y/N): " enable_email
if [[ "$enable_email" =~ ^[Yy]$ ]]; then
    echo "Please enter your SMTP credentials (e.g., Gmail App Password):"
    read -p "📧 Email User (sender@gmail.com): " EMAIL_USER
    echo ""
    read -s -p "🔑 Email Password (App Password): " EMAIL_PASS
    echo ""
    read -p "📩 Default Recipient: " EMAIL_TO

    if [ -n "$EMAIL_USER" ] && [ -n "$EMAIL_PASS" ]; then
        echo "🔒 Encrypting Email credentials..."
        echo -n "$EMAIL_USER" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/email_user.enc
        echo -n "$EMAIL_PASS" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/email_pass.enc
        if [ -n "$EMAIL_TO" ]; then
            echo -n "$EMAIL_TO" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/email_to.enc
        fi
        echo "✅ Email credentials encrypted"
    else
        echo "❌ Email fields empty, skipping."
    fi
fi

# --- 3. AWS S3 ANALYTICS (Optional) ---
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "           AWS S3 Analytics Configuration (Optional)"
echo "═══════════════════════════════════════════════════════════"
read -p "Enable S3 Analytics Upload? (y/N): " enable_s3
if [[ "$enable_s3" =~ ^[Yy]$ ]]; then
    echo "Please enter your AWS credentials:"
    read -p "🌍 AWS Region (e.g., ap-southeast-2): " AWS_REGION
    read -p "🔑 AWS Access Key ID: " AWS_ACCESS_KEY_ID
    echo ""
    read -s -p "🔐 AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
    echo ""
    read -p "📦 S3 Bucket Name: " S3_BUCKET_NAME

    if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] && [ -n "$S3_BUCKET_NAME" ]; then
        echo "🔒 Encrypting AWS credentials..."
        echo -n "$AWS_REGION" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_region.enc
        echo -n "$AWS_ACCESS_KEY_ID" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_access_key_id.enc
        echo -n "$AWS_SECRET_ACCESS_KEY" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/aws_secret_access_key.enc
        echo -n "$S3_BUCKET_NAME" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/s3_bucket_name.enc
        echo "✅ AWS credentials encrypted"
    else
        echo "❌ AWS fields empty, skipping."
    fi
fi

# --- 4. TIMESFM SIDECAR (Optional) ---
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "              TimesFM Sidecar Configuration (Optional)"
echo "═══════════════════════════════════════════════════════════"
read -p "Enable TimesFM sidecar credentials? (y/N): " enable_timesfm
if [[ "$enable_timesfm" =~ ^[Yy]$ ]]; then
    read -p "🌐 TimesFM URL (e.g. http://192.168.1.50:5050): " TIMESFM_URL
    echo ""
    read -s -p "🔐 TimesFM Shared Key: " TIMESFM_KEY
    echo ""

    if [ -n "$TIMESFM_URL" ] && [ -n "$TIMESFM_KEY" ]; then
        echo "🔒 Encrypting TimesFM sidecar settings..."
        echo -n "$TIMESFM_URL" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/timesfm_url.enc
        echo -n "$TIMESFM_KEY" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/timesfm_key.enc
        echo "✅ TimesFM sidecar settings encrypted"
    else
        echo "❌ TimesFM URL or key missing, skipping."
    fi
fi

# Set secure permissions
chmod 600 $SECRETS_DIR/* 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ All secrets encrypted and stored successfully!"
echo ""
echo "Secrets location: $SECRETS_DIR"
echo "Encryption key:   $KEYS_DIR/encryption.key"
echo ""
echo "⚠️  IMPORTANT: Back up $KEYS_DIR/encryption.key securely!"
echo "    Without it, you cannot decrypt your API keys."
echo "═══════════════════════════════════════════════════════════"
