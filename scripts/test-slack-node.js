#!/usr/bin/env node
/**
 * Test Slack Notification Service
 * Tests both simple messages and trade alerts
 */

// Load environment variables from start-wrapper.sh
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BASE_DIR = path.join(__dirname, "..");
const SECRETS_DIR = path.join(BASE_DIR, ".secrets");
const KEYS_DIR = path.join(BASE_DIR, ".keys");
const ENCRYPTION_KEY_FILE = path.join(KEYS_DIR, "encryption.key");

// Decrypt secrets
function decryptSecret(encryptedFile) {
    if (!fs.existsSync(ENCRYPTION_KEY_FILE)) {
        throw new Error("Encryption key not found");
    }
    if (!fs.existsSync(encryptedFile)) {
        return null;
    }
    const encryptionKey = fs.readFileSync(ENCRYPTION_KEY_FILE, "utf8").trim();
    try {
        const result = execSync(
            `openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -k "${encryptionKey}" -in "${encryptedFile}" 2>/dev/null`,
            { encoding: "utf8" }
        );
        return result.trim();
    } catch (error) {
        return null;
    }
}

// Load Slack webhook URL
const slackWebhookUrl = decryptSecret(
    path.join(SECRETS_DIR, "slack_webhook_url.enc")
);

if (!slackWebhookUrl) {
    console.error("❌ Slack webhook URL not configured");
    process.exit(1);
}

process.env.SLACK_WEBHOOK_URL = slackWebhookUrl;

// Now load the slack service
const slackService = require("../backend/src/services/slackService");

async function testSlackNotifications() {
    console.log("🧪 Testing Slack Notifications\n");

    // Test 1: Simple message
    console.log("Test 1: Sending simple test message...");
    try {
        await slackService.sendMessage(
            "✅ This is a simple test message from the Forex Trading Bot.\n\nIf you see this, basic Slack integration is working!",
            "#36a64f"
        );
        console.log("✅ Simple message sent successfully\n");
    } catch (error) {
        console.error("❌ Failed to send simple message:", error.message);
    }

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 2: Trade opened alert
    console.log("Test 2: Sending trade opened alert...");
    try {
        const mockTradeOpened = {
            id: "test-trade-123",
            instrument: "AUD_USD",
            side: "BUY",
            units: 10000,
            entryPrice: 0.67542,
            stopLossPrice: 0.67300,
            takeProfitPrice: 0.67800,
            entryTime: Date.now(),
            signal: "BUY",
            signalStrength: 28.5,
            entryType: "BREAKOUT",
            atrPips: 15.2,
            spreadPips: 1.5,
            leverageUsed: 10,
            marginUsedAud: 675.42,
            mode: "live",
            isOpen: true,
        };

        await slackService.sendTradeAlert(mockTradeOpened, "opened");
        console.log("✅ Trade opened alert sent successfully\n");
    } catch (error) {
        console.error("❌ Failed to send trade opened alert:", error.message);
    }

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 3: Trade closed alert (profit)
    console.log("Test 3: Sending trade closed alert (profit)...");
    try {
        const mockTradeClosedProfit = {
            id: "test-trade-123",
            instrument: "AUD_USD",
            side: "BUY",
            units: 10000,
            entryPrice: 0.67542,
            exitPrice: 0.67750,
            stopLossPrice: 0.67300,
            entryTime: Date.now() - 3600000, // 1 hour ago
            exitTime: Date.now(),
            holdingPeriodMs: 3600000, // 1 hour
            pnlAud: 20.80,
            pnlPips: 20.8,
            exitReason: "TAKE_PROFIT",
            signal: "BUY",
            signalStrength: 28.5,
            entryType: "BREAKOUT",
            atrPips: 15.2,
            spreadPips: 1.5,
            leverageUsed: 10,
            marginUsedAud: 675.42,
            mode: "live",
            isOpen: false,
        };

        await slackService.sendTradeAlert(mockTradeClosedProfit, "closed");
        console.log("✅ Trade closed alert (profit) sent successfully\n");
    } catch (error) {
        console.error(
            "❌ Failed to send trade closed alert (profit):",
            error.message
        );
    }

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 4: Trade closed alert (loss)
    console.log("Test 4: Sending trade closed alert (loss)...");
    try {
        const mockTradeClosedLoss = {
            id: "test-trade-456",
            instrument: "EUR_USD",
            side: "BUY",
            units: 5000,
            entryPrice: 1.08500,
            exitPrice: 1.08250,
            stopLossPrice: 1.08200,
            entryTime: Date.now() - 7200000, // 2 hours ago
            exitTime: Date.now(),
            holdingPeriodMs: 7200000, // 2 hours
            pnlAud: -12.50,
            pnlPips: -25.0,
            exitReason: "STOP_LOSS",
            signal: "BUY",
            signalStrength: 25.0,
            entryType: "MOMENTUM",
            atrPips: 20.0,
            spreadPips: 1.2,
            leverageUsed: 10,
            marginUsedAud: 542.50,
            mode: "live",
            isOpen: false,
        };

        await slackService.sendTradeAlert(mockTradeClosedLoss, "closed");
        console.log("✅ Trade closed alert (loss) sent successfully\n");
    } catch (error) {
        console.error(
            "❌ Failed to send trade closed alert (loss):",
            error.message
        );
    }

    console.log("🎉 All Slack notification tests completed!");
    console.log("📬 Check your Slack channel to verify all messages were received");
}

// Run tests
testSlackNotifications().catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
});
