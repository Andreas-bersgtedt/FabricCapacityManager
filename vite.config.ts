import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Azure Retail Prices API (prices.azure.com) does not send CORS headers,
// so it cannot be called directly from the browser. Proxy it through the dev /
// preview server so the request is same-origin and CORS no longer applies.
const retailPricesProxy = {
  "/api/retail-prices": {
    target: "https://prices.azure.com",
    changeOrigin: true,
    rewrite: (path: string) =>
      path.replace(/^\/api\/retail-prices/, "/api/retail/prices"),
  },
};

// Local dev server. The port is used as the SPA redirect URI in Entra.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: retailPricesProxy,
  },
  preview: {
    proxy: retailPricesProxy,
  },
});
