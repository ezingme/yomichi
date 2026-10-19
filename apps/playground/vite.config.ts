import { defineConfig } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/v1": "http://127.0.0.1:3000",
      "/readyz": "http://127.0.0.1:3000",
      "/docs": "http://127.0.0.1:3000",
      "/openapi.json": "http://127.0.0.1:3000",
    },
  },
  build: { target: "es2022" },
});
