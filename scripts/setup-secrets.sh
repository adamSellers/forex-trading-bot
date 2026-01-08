#!/bin/bash
# scripts/setup-secrets.sh - Forex Trading Bot Secure API Key Management
set -e

# --- Detect Project Root Dynamically ---
# This script is in scripts/, so go up one level to get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SECRETS_DIR="$BASE_DIR/.secrets"
KEYS_DIR="$BASE_DIR/.keys"

echo "🔐 Setting up secure API key management for Forex Bot..."
echo "📍 Project directory: $BASE_DIR"

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

# --- 2. SLACK NOTIFICATIONS (Optional) ---
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "           Slack Notification Configuration (Optional)"
echo "═══════════════════════════════════════════════════════════"
echo "To set up Slack notifications:"
echo "  1. Go to https://api.slack.com/apps"
echo "  2. Create a new app or select existing app"
echo "  3. Go to 'Incoming Webhooks' and activate"
echo "  4. Create a webhook for your channel"
echo "  5. Copy the webhook URL"
echo ""
read -p "Enable Slack Notifications? (y/N): " enable_slack
if [[ "$enable_slack" =~ ^[Yy]$ ]]; then
    read -p "💬 Slack Webhook URL: " SLACK_WEBHOOK_URL

    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        echo "🔒 Encrypting Slack webhook URL..."
        echo -n "$SLACK_WEBHOOK_URL" | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$(cat $KEYS_DIR/encryption.key)" > $SECRETS_DIR/slack_webhook_url.enc
        echo "✅ Slack webhook URL encrypted"
    else
        echo "❌ Slack webhook URL empty, skipping."
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