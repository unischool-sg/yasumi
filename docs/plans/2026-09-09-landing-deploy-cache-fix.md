# landing デプロイの Docker キャッシュ取りこぼし修正

## 症状
本番 `/schools` が学校一覧を表示できない。ページ内 fetch 先が相対 `/public/schools` のまま
（= 旧ビルド）で、`API_BASE` 既定を本番APIにした修正(PR #15)をマージ・デプロイ成功後も反映されない。
`last-modified` が PR #14 時刻のまま。

## 原因
`docker/landing.Dockerfile` は multi-stage（build=astro → serve=nginx）。デプロイ #15 のログで:
- `COPY landing ./landing` … DONE（新 consts.ts 反映）
- `RUN bun run --cwd landing build` … 実行（新 dist 生成）
- **`COPY --from=build /app/landing/dist` … CACHED** ← 最終段が旧 dist 層を再利用

BuildKit の `COPY --from` が、ソース段の dist 内容変更を取りこぼしてキャッシュヒットし、
古い dist を最終イメージに入れてしまう。結果コンテナは再作成されるが中身は旧のまま。

## 修正
`.github/workflows/deploy.yml` の「ビルド & 起動」ステップで、**landing だけ毎回クリーンビルド**する:
```
docker compose ... build --no-cache landing
docker compose ... up -d --build
```
landing は稀なデプロイかつ小さいので、no-cache の再ビルド（bun install 含む数十秒）は許容。
これで `COPY --from` の取りこぼしが起きず、常に最新 dist が配信される。

## 検証
- PR→マージ→デプロイ後、本番 `/schools/` の fetch 先が
  `https://yasumi-api.unischool.jp/public/schools` になり、`last-modified` が更新される。
- ブラウザで学校一覧（三田学園高等学校）が表示される。

## 備考
- frontend/admin も同じ multi-stage 構造だが、VITE_ 系 build arg が env で変わると RUN 層が
  invalidate されやすく、今回のような固定内容の取りこぼしは起きにくい。必要なら将来同様の対処。
- 恒久的にはコミットSHAで最終段のキャッシュを busting する手もあるが、確実性重視で no-cache を採用。
