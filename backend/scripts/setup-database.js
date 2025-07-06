// backend/scripts/setup-database.js
const fs = require("fs");
const path = require("path");

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, "../../data");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("✅ Created data directory:", dataDir);
}

// Create .gitkeep file to ensure directory is tracked
const gitkeepPath = path.join(dataDir, ".gitkeep");
if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, "");
    console.log("✅ Created .gitkeep file");
}

console.log("📁 Data directory setup complete");
