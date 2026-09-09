# やすみ？ Cron 仕様書（cron.ts）

> 本書は [PRD.md](../PRD.md) §26, §34〜§36, §56, §57 を、
> **「API と同一プロセス内で 30 分ごとに実行し、`app.fetch` で判定を駆動する」** 方式に更新して具体化したもの。
>
> ⚠️ PRD §48/§56 の「別コンテナ Scheduler・1 分ごと」から方針変更:
> - 実行間隔: 1 分 → **30 分ごと**
> - 実行形態: 別プロセス（`dist/scheduler.js`）→ **API プロセス内 cron**
> - 判定の駆動: 直接呼び出し → **`app.fetch()` で内部エンドポイントを叩く**

---

## 1. 目的と方針

- 別コンテナを立てず、**API サーバーと同一プロセス**で cron を動かす。
- cron は判定ロジックを直接持たず、**Hono の `app.fetch()` を使って内部エンドポイントを呼ぶ**。
  → 判定処理を HTTP ハンドラとして 1 本化し、cron からも手動 HTTP からも同じ経路で実行できる。
- 起動間隔は **30 分ごと**。判定時刻（`school_rules.check_time`）が 30 分粒度で登録される前提。

---

## 2. 配置

```text
backend/src/
├─ cron.ts              … cron スケジューラ本体（本書の対象）
├─ server.ts            … entrypoint。app 起動時に startCron(app) を呼ぶ
└─ api/
   └─ internal/
      └─ run-check.ts   … cron が app.fetch で叩く内部判定エンドポイント
```

---

## 3. cron.ts のインターフェース

```ts
import type { Hono } from "hono";

/**
 * API プロセス起動時に呼ぶ。30 分ごとに内部判定エンドポイントを app.fetch で叩く。
 * @returns 停止用関数（テスト・graceful shutdown 用）
 */
export function startCron(app: Hono): () => void;
```

- `server.ts` の起動シーケンスで `const stop = startCron(app)` を呼ぶ。
- SIGTERM / SIGINT 受信時に `stop()` を呼んでタイマーを解除する。

---

## 4. スケジューリング仕様

### 4.1 実行タイミング（30 分ごと）

- 毎時 **00 分 / 30 分** に実行する（"0,30 * * * *" 相当）。
- 実装は次のいずれか（MVP はライブラリ非依存の 2. を推奨）:
  1. `node-cron` 等で `"0,30 * * * *"` を登録
  2. 素の `setTimeout` で「次の :00 / :30」までの残り時間を計算 → 発火 → 再スケジュール
     （プロセス起動が例えば 08:07 でも、初回は 08:30 に揃える）

### 4.2 対象ルールの決定

- 発火時の「時:分」（例 `08:30`）に一致する `check_time` を持つ `school_rules` のみ処理。
- これにより 30 分粒度の判定時刻だけがヒットする。
- `check_time` は 30 分刻み（`HH:00` / `HH:30`）で登録される前提（フロントの登録 UI 側で制約）。

---

## 5. app.fetch による駆動

cron は判定を **自前で実行せず**、内部エンドポイントへ `app.fetch` でリクエストする。

```ts
// cron.ts 内（擬似コード）
async function tick(app: Hono) {
  const res = await app.fetch(
    new Request("http://internal/api/internal/run-check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": process.env.INTERNAL_CRON_TOKEN ?? "",
      },
      body: JSON.stringify({ triggeredAt: /* 発火時刻 ISO */ }),
    }),
  );
  // res.status / ログ出力
}
```

- `app.fetch(Request)` は Hono の標準 API。ネットワークを介さずプロセス内でハンドラを実行する。
- 認可: 内部トークン (`x-internal-token` = `INTERNAL_CRON_TOKEN`) を検証し、
  外部から `/api/internal/*` を叩けないようにする（PRD §54 API 認可）。

---

## 6. 内部判定エンドポイント（run-check）

`POST /api/internal/run-check` は PRD §57 の判定パイプラインを実装する。
cron 発火時、または手動デバッグ時に叩かれる。

処理（PRD §57）:

```text
リクエスト受信（triggeredAt）
 ↓ triggeredAt の HH:MM に一致する school_rules を検索
 ↓ 対象学校の必要地域を集約 → 気象庁から警報を一括取得（キャッシュ共有 / PRD §33）
 ↓ 学校ごとに Rule Engine で評価（evaluateSchoolRule）
 ↓ warning_checks 保存  … UNIQUE(school_id, rule_id, target_date) で二重判定防止（§35）
 ↓ 各学校の Subscription を取得
 ↓ 通知対象 User へ LINE Push（NORMAL は通知しない / §19）
 ↓ notifications 保存    … UNIQUE(user_id, school_id, rule_id, target_date) で二重通知防止（§36）
 ↓ 集計結果を JSON で返す（処理学校数 / 判定件数 / 通知件数 / エラー件数）
```

`target_date` は `triggeredAt` の日付（JST 基準）とする。

---

## 7. 冪等性・エラー処理

- **冪等性**: 判定・通知は UNIQUE 制約で二重実行されない（PRD §35, §36）。
  プロセス再起動や重複発火があっても結果は 1 回に収束する。
- **判定の確定性**（PRD §34）: 08:30 判定で警報ありなら、後で解除されても結果は変えない。
- **気象情報取得失敗**（PRD §51, §52）: `NORMAL` にせず `UNKNOWN` として保存・通知。
- **多重発火防止**: 前回 tick が実行中に次が来ても重複しないよう、
  実行中フラグ（in-flight guard）で同時実行を 1 本に絞る。
- **ログ**: 発火時刻・対象学校数・判定/通知件数・エラーを標準出力へ。

---

## 8. タイムゾーン

- 判定時刻・`target_date` は **JST 基準**で扱う。
- コンテナ/プロセスの TZ を JST に固定するか、日時計算時に明示変換する。

---

## 9. Docker / プロセス構成への影響

- **別コンテナ `scheduler` は不要**になる（cron が api プロセス内に同居）。
  → `docker/SPEC.md` の compose から `scheduler` サービスを削除。
- `LINE_CHANNEL_ACCESS_TOKEN` は api コンテナ側で必要（Push を api プロセスが行うため）。
- 追加環境変数: `INTERNAL_CRON_TOKEN`（内部エンドポイント認可用）。

> トレードオフ: 同一プロセス化で運用はシンプルになるが、
> API とバックグラウンド判定が同居するため、判定処理が重い場合は
> API レイテンシに影響しうる。MVP 規模（学校数が少ない）では許容。
> 将来スケール時は再度別コンテナ / キュー化を検討（本書に記録）。
