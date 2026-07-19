import { defineConfig } from "vite";

// Standalone Canvas-2D frontend. Runs on a dedicated port (5273) alongside the
// React app (5173), against the same backend (VITE_API_BASE). Tunnel-friendly.
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5273,
    strictPort: true,
    allowedHosts: [".trycloudflare.com"],
  },
  preview: {
    host: "0.0.0.0",
    port: 5273,
    strictPort: true,
    allowedHosts: [".trycloudflare.com"],
  },
});
