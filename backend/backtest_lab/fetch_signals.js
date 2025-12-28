// backend/backtest_lab/fetch_signals.js
const {
    S3Client,
    GetObjectCommand,
    paginateListObjectsV2,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

// FIX: Look up one level for the backend .env
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

async function downloadSignalLogs() {
    const bucket = process.env.S3_BUCKET_NAME;
    console.log(`📡 Connecting to S3 Bucket: ${bucket}...`);

    // FIX: Store data inside /backend/backtest_lab/data/raw_signals
    const labDataDir = path.join(__dirname, "data", "raw_signals");
    if (!fs.existsSync(labDataDir))
        fs.mkdirSync(labDataDir, { recursive: true });

    let count = 0;

    try {
        const paginator = paginateListObjectsV2(
            { client: s3 },
            { Bucket: bucket, Prefix: "signal-log/" }
        );

        for await (const page of paginator) {
            if (!page.Contents) continue;

            for (const file of page.Contents) {
                if (file.Key.endsWith("/")) continue;

                const fileName = path.basename(file.Key);
                const outFile = path.join(labDataDir, fileName);

                if (fs.existsSync(outFile)) {
                    process.stdout.write(".");
                    continue;
                }

                console.log(`\n⬇️ Downloading ${fileName}...`);
                const getCmd = new GetObjectCommand({
                    Bucket: bucket,
                    Key: file.Key,
                });
                const response = await s3.send(getCmd);
                await pipeline(response.Body, fs.createWriteStream(outFile));
                count++;
            }
        }

        console.log(
            `\n\n✅ Mission Complete. ${count} new signal logs secured.`
        );
        console.log(`📂 Location: ${labDataDir}`);
    } catch (err) {
        console.error("\n❌ Extraction Failed:", err);
    }
}

downloadSignalLogs();
