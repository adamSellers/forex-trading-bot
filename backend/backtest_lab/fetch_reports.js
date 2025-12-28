// backend/backtest_lab/fetch_reports.js
const {
    S3Client,
    GetObjectCommand,
    paginateListObjectsV2,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

async function downloadAllReports() {
    const bucket = process.env.S3_BUCKET_NAME;
    console.log(`📦 Scanning bucket: ${bucket}...`);

    // FIX: Store inside lab data folder
    const downloadDir = path.join(__dirname, "data", "reports");
    if (!fs.existsSync(downloadDir))
        fs.mkdirSync(downloadDir, { recursive: true });

    let count = 0;

    try {
        const paginator = paginateListObjectsV2(
            { client: s3 },
            { Bucket: bucket, Prefix: "performance-report-" }
        );

        for await (const page of paginator) {
            if (!page.Contents) continue;

            for (const file of page.Contents) {
                if (!file.Key.endsWith(".json")) continue;

                const outFile = path.join(downloadDir, path.basename(file.Key));

                // Optional: Skip if already downloaded
                // if (fs.existsSync(outFile)) continue;

                console.log(`⬇️ Downloading ${file.Key}...`);
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
            `✅ Success! Downloaded ${count} reports to ${downloadDir}`
        );
    } catch (err) {
        console.error("❌ Error fetching S3:", err);
    }
}

downloadAllReports();
