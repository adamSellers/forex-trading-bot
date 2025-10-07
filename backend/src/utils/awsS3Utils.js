// backend/src/utils/awsS3Utils.js
const AWS = require("aws-sdk");
const logger = require("./logger");

let s3Client = null;

/**
 * Initializes the S3 client using credentials from environment variables.
 */
function initializeS3() {
    // NEW: Only initialize if the feature is explicitly enabled.
    if (process.env.ENABLE_S3_ANALYTICS !== "true") {
        logger.info("☁️  S3 analytics upload is disabled by configuration.");
        return;
    }

    if (
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY &&
        process.env.AWS_REGION
    ) {
        s3Client = new AWS.S3({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            region: process.env.AWS_REGION,
        });
        logger.info("☁️  AWS S3 client initialized.");
    } else {
        logger.warn(
            "⚠️  AWS S3 credentials not found in environment. S3 uploads will be disabled."
        );
    }
}

/**
 * Uploads a JSON object to a specified S3 bucket.
 * @param {string} bucketName - The name of the S3 bucket.
 * @param {string} key - The file name/path to use in the bucket.
 * @param {object} jsonData - The JSON object to upload.
 * @returns {Promise<object|null>} The S3 upload result or null on failure.
 */
async function uploadJsonToS3(bucketName, key, jsonData) {
    if (!s3Client) {
        logger.error("S3 client not initialized. Cannot upload.");
        return null;
    }

    const params = {
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify(jsonData, null, 2),
        ContentType: "application/json",
    };

    try {
        const data = await s3Client.upload(params).promise();
        logger.info(`Successfully uploaded ${key} to S3 bucket ${bucketName}.`);
        return data;
    } catch (error) {
        logger.error(`Failed to upload ${key} to S3:`, error);
        return null;
    }
}

// Initialize on module load
initializeS3();

module.exports = {
    uploadJsonToS3,
};
