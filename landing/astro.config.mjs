import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// やすみ？ ランディングページ（静的サイト）。
// 公開ドメインは PUBLIC_SITE_URL で上書き可能（canonical / og:url / sitemap の基準URL）。
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "https://yasumi.unischool.jp",
  integrations: [sitemap()],
  server: { port: 4321 },
});
