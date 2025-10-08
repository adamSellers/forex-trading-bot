// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:3001",
                changeOrigin: true,
                secure: false,
            },
            "/socket.io": {
                target: "http://localhost:3001",
                changeOrigin: true,
                ws: true,
            },
        },
    },
    build: {
        outDir: "dist",
        sourcemap: true,
        rollupOptions: {
            // FIX: Exclude the server-side AWS SDK from the frontend bundle.
            // This prevents the build process from hanging while trying to
            // resolve and bundle a large, unnecessary backend dependency.
            external: ["@aws-sdk/client-s3"],
        },
    },
});
