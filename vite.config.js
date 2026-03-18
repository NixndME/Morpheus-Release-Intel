import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // During local dev: /api/jira/* → handled by vite proxy → server.js on :3001
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
