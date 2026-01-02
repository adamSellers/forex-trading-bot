#!/usr/bin/env node
// scripts/testConnection.js - Quick Oanda connection test
// No dependencies required - uses native fetch (Node 18+)

async function testConnection() {
    console.log("\n🔌 Testing Oanda API Connection...\n");

    // Check environment
    const apiKey = process.env.OANDA_API_KEY;
    const accountId = process.env.OANDA_ACCOUNT_ID || "001-011-20128302-001";
    const environment = process.env.OANDA_ENVIRONMENT || "live";

    if (!apiKey) {
        console.error("❌ OANDA_API_KEY not set in environment");
        console.log("\nSet it with: export OANDA_API_KEY='your-key-here'");
        process.exit(1);
    }

    const keyPreview = `${apiKey.substring(0, 4)}...${apiKey.slice(-4)}`;
    console.log(`📋 Config:`);
    console.log(`   API Key: ${keyPreview}`);
    console.log(`   Account: ${accountId}`);
    console.log(`   Environment: ${environment}`);

    const baseUrl =
        environment === "practice"
            ? "https://api-fxpractice.oanda.com"
            : "https://api-fxtrade.oanda.com";

    // Test 1: Account Summary
    console.log("\n1️⃣ Testing Account Summary...");
    try {
        const response = await fetch(
            `${baseUrl}/v3/accounts/${accountId}/summary`,
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const account = data.account;

        console.log(`   ✅ Connected!`);
        console.log(`   Balance: ${account.balance} ${account.currency}`);
        console.log(`   Margin Used: ${account.marginUsed}`);
        console.log(`   Margin Available: ${account.marginAvailable}`);
        console.log(`   Open Trades: ${account.openTradeCount}`);
        console.log(`   Unrealized P&L: ${account.unrealizedPL}`);
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
        process.exit(1);
    }

    // Test 2: Get Pricing
    console.log("\n2️⃣ Testing Price Feed...");
    try {
        const instruments = "AUD_USD,EUR_USD,GBP_USD,USD_JPY";
        const response = await fetch(
            `${baseUrl}/v3/accounts/${accountId}/pricing?instruments=${instruments}`,
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log(`   ✅ Got prices for ${data.prices.length} instruments:`);

        data.prices.forEach((price) => {
            const bid = parseFloat(price.bids?.[0]?.price || 0);
            const ask = parseFloat(price.asks?.[0]?.price || 0);
            const spread = ask - bid;
            const pipValue = price.instrument.includes("JPY") ? 0.01 : 0.0001;
            const spreadPips = spread / pipValue;

            console.log(
                `   ${price.instrument}: Bid ${bid.toFixed(
                    5
                )} | Ask ${ask.toFixed(5)} | Spread ${spreadPips.toFixed(
                    1
                )} pips`
            );
        });
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
    }

    // Test 3: Get Candles
    console.log("\n3️⃣ Testing Historical Data...");
    try {
        const response = await fetch(
            `${baseUrl}/v3/instruments/AUD_USD/candles?granularity=M15&count=5&price=M`,
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log(
            `   ✅ Got ${data.candles.length} candles for AUD_USD M15:`
        );

        data.candles.slice(-3).forEach((c) => {
            // Oanda returns ISO 8601 string format
            const time = c.time.substring(0, 16).replace("T", " ");
            console.log(
                `   ${time} | O:${c.mid.o} H:${c.mid.h} L:${c.mid.l} C:${c.mid.c}`
            );
        });
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
    }

    console.log("\n✅ Connection test complete!\n");
}

testConnection();
