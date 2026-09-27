import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // LAN + tunnel hosts used when testing the QR scanner from a phone.
    allowedHosts: ["localhost", "127.0.0.1", ".ngrok-free.app", ".trycloudflare.com"],
  },
  build: {
    // The bundle is served by Flask from the same origin in production.
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
