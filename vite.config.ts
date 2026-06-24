import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev server. The port is used as the SPA redirect URI in Entra.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
