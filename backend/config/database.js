import knex from "knex";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = knex({
    client: "sqlite3",
    connection: {
        filename: path.join(__dirname, "../../data/trading_bot.db"),
    },
    useNullAsDefault: true,
    migrations: {
        directory: path.join(__dirname, "../migrations"),
    },
});

export default db;
