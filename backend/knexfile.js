import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
    development: {
        client: "sqlite3",
        connection: {
            filename: path.join(__dirname, "../data/trading_bot.db"),
        },
        useNullAsDefault: true,
        migrations: {
            directory: "./migrations",
        },
    },
};
