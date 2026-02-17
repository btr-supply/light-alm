import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { mdPrerender } from "./src/lib/md-prerender";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [mdPrerender(), tailwindcss(), svelte()],
  resolve: {
    alias: {
      "$lib": resolve(__dirname, "src/lib"),
      "$docs": resolve(__dirname, "../docs"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
