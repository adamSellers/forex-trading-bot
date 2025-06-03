import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import db from "../config/database.js";

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173", // Vite dev server
        methods: ["GET", "POST"],
    },
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json());

// Test database connection
db.raw("SELECT 1")
    .then(() => console.log("✅ Database connected"))
    .catch((err) => console.error("❌ Database connection failed:", err));

// Basic routes
app.get("/api/health", (req, res) => {
    res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
    });
});

// Socket.io connection
io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:5173`);
});

export { app, io };
