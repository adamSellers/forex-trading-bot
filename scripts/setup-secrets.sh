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
read -p "📋 Oanda Account ID [001-011-20128302-001]: " OANDA_ACCOUNT_ID
OANDA_ACCOUNT_ID=${OANDA_ACCOUNT_ID:-001-011-20128302-001}
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