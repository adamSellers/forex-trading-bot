// scripts/audit_s3_reports.js
const path = require('path');
const fs = require('fs');

// Usage: Run this from the 'backend' directory:
// cd backend && node ../scripts/audit_s3_reports.js

// Load env relative to this script location
const envPath = path.join(__dirname, '../backend/.env');
console.log(`Loading .env from: ${envPath}`);
require('dotenv').config({ path: envPath });

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const TEMP_DIR = path.join(__dirname, '../temp_reports');

// Initialize S3 Client
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const PERF_BUCKET = process.env.S3_BUCKET_NAME; // forex-bot-log-stash
const SIGNAL_BUCKET = process.env.S3_BUCKET_FOR_SIGNALS; // forex-signal-log

// Helper to save stream to file
const streamToString = (stream) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

async function listAndDownload(bucketName, label) {
    if (!bucketName) {
        console.log(`⚠️  No bucket configured for ${label}`);
        return;
    }

    console.log(`\n🔎 Scanning ${label} Bucket: ${bucketName}...`);

    try {
        const listCmd = new ListObjectsV2Command({ Bucket: bucketName });
        const data = await s3Client.send(listCmd);

        if (!data.Contents || data.Contents.length === 0) {
            console.log(`   No files found in ${bucketName}`);
            return;
        }

        // Sort by LastModified descending
        const sortedFiles = data.Contents.sort((a, b) => b.LastModified - a.LastModified);
        const recentFiles = sortedFiles.slice(0, 5); // Grab top 5

        console.log(`   Found ${data.Contents.length} files. Downloading recent ${recentFiles.length}...`);

        for (const file of recentFiles) {
            console.log(`   ⬇️  Downloading ${file.Key} (${file.LastModified})`);

            const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: file.Key });
            const item = await s3Client.send(getCmd);
            const content = await streamToString(item.Body);

            // Ensure directory structure exists
            const localPath = path.join(TEMP_DIR, bucketName, file.Key);
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            fs.writeFileSync(localPath, content);
            console.log(`      ✅ Saved to ${localPath}`);

            // Try to parse JSON and print summary
            try {
                const json = JSON.parse(content);
                if (label === 'PERFORMANCE' && json.summary) {
                    // Try to handle different report formats
                    const trades = json.summary.totalTrades || json.totalTrades || 0;
                    const pnl = json.summary.totalPnLAud || json.totalPnLAud || 0;
                    const wr = json.summary.winRate || json.winRate || 0;
                    console.log(`      📊 Stats: Trades=${trades}, P/L=$${pnl}, WR=${wr}%`);
                }
            } catch (e) {
                // Not JSON or plain text
            }
        }

    } catch (err) {
        console.error(`   ❌ Error accessing ${bucketName}:`, err.message);
    }
}

async function main() {
    console.log("🚀 Starting S3 Report Audit...");
    console.log(`CREDENTIALS: ${process.env.AWS_ACCESS_KEY_ID ? 'OK' : 'MISSING'}`);

    // Clear/Create temp dir
    if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR);

    await listAndDownload(PERF_BUCKET, 'PERFORMANCE');
    await listAndDownload(SIGNAL_BUCKET, 'SIGNALS');

    console.log("\n✅ Audit Complete. Files saved in 'temp_reports/'");
}

main();
