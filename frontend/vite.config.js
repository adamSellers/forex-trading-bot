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
    },
    // Help Vite resolve hoisted dependencies in the npm workspace.
    // This forces Vite to find and pre-bundle the specified module.
    optimizeDeps: {
        include: ["socket.io-client"],
    },
    // This is crucial for monorepos (npm workspaces). It ensures that Vite
    // correctly resolves modules from the hoisted node_modules directory
    // at the project root by respecting the symlinked package structure.
    resolve: {
        preserveSymlinks: true,
    },
});
