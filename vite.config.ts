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
        index: resolve(import.meta.dirname, "index.html"),
        take: resolve(import.meta.dirname, "take.html"),
        build: resolve(import.meta.dirname, "build.html"),
      },
    },
  },
});
