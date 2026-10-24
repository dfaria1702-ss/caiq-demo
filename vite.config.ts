import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig(({ mode }) => {
  // Load .env.local into process.env for server functions only (no VITE_ prefix → never bundled to the client).
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    server: { port: 3100 },
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()], // nitro → auto "vercel" preset when built on Vercel
  };
});
