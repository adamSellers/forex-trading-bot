// backend/src/utils/awsS3Utils.js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const logger = require("./logger");

let s3Client = null;

/**
 * Initializes the S3 client using credentials from environment variables.
 */
function initializeS3() {
    if (process.env.ENABLE_S3_ANALYTICS !== "true") {
        logger.info("☁️  S3 analytics upload is disabled by configuration.");
        return;
    }

    // V3 automatically reads credentials from env vars (AWS_ACCESS_KEY_ID, etc.)
    if (
        process.env.AWS_REGION &&
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY
    ) {
        s3Client = new S3Client({ region: process.env.AWS_REGION });
        logger.info("☁️  AWS S3 client initialized.");
    } else {
        logger.warn(
            "⚠️  AWS S3 credentials not fully configured in environment. S3 uploads will be disabled."
        );
    }
}

/**
 * Uploads a JSON object to a specified S3 bucket.
 * @param {string} bucketName - The name of the S3 bucket.
 * @param {string} key - The file name/path to use in the bucket.
 * @param {object} data - The JSON object to upload.
 * @returns {Promise<boolean>} - True if the upload was successful, false otherwise.
 */
async function uploadJsonToS3(bucketName, key, data) {
    if (!s3Client) {
        // This is now an expected state if S3 is disabled, so we don't log an error.
        return false;
    }

    // V3: Create a command with the parameters.
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: "application/json",
    });

    try {
        // V3: Send the command to the client.
        await s3Client.send(command);
        return true;
    } catch (error) {
        logger.error(`Failed to upload ${key} to S3:`, error);
        return false;
    }
}

// Initialize on module load
initializeS3();

module.exports = {
    uploadJsonToS3,
};
