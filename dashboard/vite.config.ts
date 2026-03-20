import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { mdPrerender } from "./src/lib/md-prerender";
import { resolve } from "node:path";

const apiPort = parseInt(process.env.API_PORT || "40042");
const dashboardPort = parseInt(process.env.DASHBOARD_PORT || "40043");

export default defineConfig({
  plugins: [mdPrerender(), tailwindcss(), svelte()],
  resolve: {
    alias: {
      "$lib": resolve(__dirname, "src/lib"),
      "$docs": resolve(__dirname, "../docs"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes("lightweight-charts")) return "charts";
          if (id.includes("minisearch")) return "search";
          if (id.includes("paneforge")) return "ui";
        },
      },
    },
  },
  server: {
    port: dashboardPort,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
