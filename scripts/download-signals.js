const path = require("path");
// Try loading from backend first, fall back to current directory
const envPath = path.resolve(__dirname, "../backend/.env");
require("dotenv").config({ path: envPath });

// Fallback if that didn't work (try local folder)
if (!process.env.S3_BUCKET_FOR_SIGNALS && !process.env.S3_BUCKET_NAME) {
    require("dotenv").config();
}

const {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const { pipeline } = require("stream/promises");

// Configuration
// Use S3_BUCKET_FOR_SIGNALS if available, otherwise fall back to S3_BUCKET_NAME
const BUCKET_NAME =
    process.env.S3_BUCKET_FOR_SIGNALS || process.env.S3_BUCKET_NAME;

// Debug Block - Check if config loaded
if (!BUCKET_NAME) {
    console.error("❌ ERROR: Bucket name is missing from .env file.");
    console.error(`   Checked path: ${envPath}`);
    console.error(
        "   Please ensure 'backend/.env' exists and has S3_BUCKET_FOR_SIGNALS or S3_BUCKET_NAME defined."
    );
    process.exit(1);
}

const PREFIX = "signal-log/";
const DOWNLOAD_DIR = path.join(__dirname, "../data/backtest_signals");

// Initialize S3 Client
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

async function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Helper to stream S3 body to string
async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf-8");
}

async function downloadSignals() {
    console.log(`🚀 Starting Signal Download from bucket: ${BUCKET_NAME}`);
    await ensureDir(DOWNLOAD_DIR);

    let continuationToken = undefined;
    let allSignals = [];
    let fileCount = 0;

    do {
        // 1. List Objects
        const listCmd = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: PREFIX,
            ContinuationToken: continuationToken,
        });

        const listRes = await s3.send(listCmd);
        const objects = listRes.Contents || [];

        if (objects.length === 0) {
            console.log("⚠️ No signal logs found in S3.");
            break;
        }

        console.log(
            `📦 Found ${objects.length} files in this page. Downloading...`
        );

        // 2. Download Each File
        for (const obj of objects) {
            // Skip folders
            if (obj.Key.endsWith("/")) continue;

            try {
                console.log(`   ⬇️ Downloading ${obj.Key}...`);
                const getCmd = new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: obj.Key,
                });

                const data = await s3.send(getCmd);
                const jsonStr = await streamToString(data.Body);
                const signals = JSON.parse(jsonStr);

                if (Array.isArray(signals)) {
                    allSignals.push(...signals);
                } else {
                    allSignals.push(signals);
                }
                fileCount++;
            } catch (err) {
                console.error(
                    `   ❌ Failed to download ${obj.Key}:`,
                    err.message
                );
            }
        }

        continuationToken = listRes.NextContinuationToken;
    } while (continuationToken);

    // 3. Process and Save Merged Data
    console.log(`\n✅ Download Complete. Processed ${fileCount} files.`);

    if (allSignals.length > 0) {
        // Sort by timestamp
        allSignals.sort(
            (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );

        // Remove duplicates (based on timestamp + symbol)
        const uniqueSignals = Array.from(
            new Map(
                allSignals.map((item) => [
                    item.timestamp + item.signal.symbol,
                    item,
                ])
            ).values()
        );

        const outputPath = path.join(DOWNLOAD_DIR, "merged_signals.json");
        fs.writeFileSync(outputPath, JSON.stringify(uniqueSignals, null, 2));

        console.log(`📊 Total Unique Signals: ${uniqueSignals.length}`);
        console.log(`💾 Saved merged dataset to: ${outputPath}`);
    } else {
        console.log("⚠️ No signals were downloaded/merged.");
    }
}

downloadSignals().catch((err) => {
    console.error("🔥 Fatal Error:", err);
});
