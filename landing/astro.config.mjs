import { defineConfig } from "astro/config";

// やすみ？ ランディングページ（静的サイト）。
export default defineConfig({
  site: "https://yasumi.example.com",
  server: { port: 4321 },
});
