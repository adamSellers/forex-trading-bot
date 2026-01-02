// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3100, // Forex frontend port
        proxy: {
            "/api": {
                target: "http://localhost:3101", // Forex backend port
                changeOrigin: true,
                secure: false,
            },
            "/socket.io": {
                target: "http://localhost:3101",
                changeOrigin: true,
                ws: true,
            },
        },
    },
    build: {
        outDir: "dist",
        // CRITICAL OPTIMIZATION for Raspberry Pi:
        // Disable source maps to reduce RAM usage by ~40% during build.
        sourcemap: false,
        // Increase the chunk size warning limit to reduce log spam
        chunkSizeWarningLimit: 1600,
        rollupOptions: {
            output: {
                // OPTIMIZATION: Split vendor chunks to reduce per-file memory pressure
                manualChunks: (id) => {
                    if (id.includes("node_modules")) {
                        return "vendor";
                    }
                },
            },
        },
    },
});
