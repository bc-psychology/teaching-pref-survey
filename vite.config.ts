import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built site works from any GitHub Pages path (/<repo>/).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        take: resolve(__dirname, "take.html"),
        build: resolve(__dirname, "build.html"),
      },
    },
  },
});
