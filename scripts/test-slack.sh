#!/bin/bash
# Test Slack notification
# =====================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="$BASE_DIR/.secrets"
KEYS_DIR="$BASE_DIR/.keys"
ENCRYPTION_KEY_FILE="$KEYS_DIR/encryption.key"

# Check if encryption key exists
if [ ! -f "$ENCRYPTION_KEY_FILE" ]; then
    echo "❌ Encryption key not found at $ENCRYPTION_KEY_FILE"
    exit 1
fi

# Decrypt Slack webhook URL
SLACK_WEBHOOK_URL_FILE="$SECRETS_DIR/slack_webhook_url.enc"
if [ ! -f "$SLACK_WEBHOOK_URL_FILE" ]; then
    echo "❌ Slack webhook URL not configured"
    exit 1
fi

ENCRYPTION_KEY=$(cat "$ENCRYPTION_KEY_FILE")
SLACK_WEBHOOK_URL=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "$ENCRYPTION_KEY" -in "$SLACK_WEBHOOK_URL_FILE" 2>/dev/null)

if [ -z "$SLACK_WEBHOOK_URL" ]; then
    echo "❌ Failed to decrypt Slack webhook URL"
    exit 1
fi

echo "✅ Slack webhook URL decrypted"
echo "📤 Sending test message to Slack..."

# Create test message payload
TIMESTAMP=$(date +%s)
MESSAGE="🧪 **Test Notification**\n\nThis is a test message from the Forex Trading Bot to verify Slack notifications are working correctly.\n\n✅ If you see this message, Slack integration is working!"

PAYLOAD=$(cat <<EOF
{
  "username": "Forex Trading Bot",
  "icon_emoji": ":chart_with_upwards_trend:",
  "attachments": [
    {
      "color": "#36a64f",
      "title": "🧪 Slack Notification Test",
      "text": "$MESSAGE",
      "footer": "Forex Trading Bot",
      "ts": $TIMESTAMP
    }
  ]
}
EOF
)

# Send to Slack
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$SLACK_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Test message sent successfully!"
    echo "📬 Check your Slack channel for the test message"
    exit 0
else
    echo "❌ Failed to send test message"
    echo "HTTP Code: $HTTP_CODE"
    echo "Response: $BODY"
    exit 1
fi
