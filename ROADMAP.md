# やすみ？ 開発ロードマップ

> [PRD.md](./PRD.md) の §58（MVP実装順）をベースに、
> 各仕様書（[backend/SPEC.md](./backend/SPEC.md) / [backend/CRON.md](./backend/CRON.md) /
> [frontend/SPEC.md](./frontend/SPEC.md) / [docker/SPEC.md](./docker/SPEC.md)）の
> 方針変更（同一プロセス cron・30分ごと・`app.fetch` 駆動）を反映した実装計画。

**構成**:
- **Part 1 — MVP（M0〜M8）**: 無料プロダクトの芯。**実装完了・本番公開済み**。
- **Part 2 — 収益化ロードマップ（M9〜M14）**: 学校向け有料SaaS（先生ダッシュボード＋欠席受付＋課金）。
  設計は [docs/plans/2026-09-10-school-saas-mvp.md](./docs/plans/2026-09-10-school-saas-mvp.md)、
  事業方針はメモリ `monetization-plan`。

---

## Part 1 — MVP マイルストーン全体像

```text
M0 基盤セットアップ
   ↓
M1 気象庁 Adapter（データ取得の芯）
   ↓
M2 Rule Engine（判定ロジックの芯）
   ↓
M3 DB / Drizzle（永続化）
   ↓
M4 API + LIFF 認証（ユーザーが繋がる）
   ↓
M5 学校登録 UI（データが入る）
   ↓
M6 LINE Push（通知が出る）
   ↓
M7 Cron 判定パイプライン（自動で回る）
   ↓
M8 デプロイ / 一般公開
```

判定に必要な「芯」を先に作る（M1→M2）。芯があれば DB や UI が無くても
単体テストで判定ロジックを検証できる。PRD §58 と同方針。

---

## M0. 基盤セットアップ

**目的**: 全員が同じ土台で開発を始められる状態。

- [ ] `backend/` 雛形: `package.json` / `tsconfig.json` / Hono 起動 (`server.ts`) / ESLint・Prettier
- [ ] `frontend/` 雛形: Vite + React + TS + Tailwind + `@line/liff`
- [ ] `docker/`: `docker-compose.yml`（api + postgres の2コンテナ）/ `.env.example`
- [ ] `Makefile`: `up` / `down` / `logs` / `migrate` / `dev` 等
- [ ] `README.md`: セットアップ手順・構成概要
- [ ] `.gitignore`（`.env` / `node_modules` / `dist` 等）

**完了条件**: `make up` で api と postgres が起動し、`GET /health` が 200 を返す。

---

## M1. 気象庁 Adapter（PRD §31, §32, §33 / Phase 1）

**目的**: 指定地域コード → 現在の警報 `Warning[]` を取得できる。

> 📄 **詳細仕様確定済み**: [backend/JMA_ADAPTER.md](./backend/JMA_ADAPTER.md)

- [x] `domain/warning/provider.ts`: `WarningProvider` ポート
- [x] `infrastructure/jma/`: `JmaWarningProvider`（気象庁レスポンス → `Warning[]` 正規化）+ `parse.ts` / `warning-codes.ts`
- [x] 地域コード基準の取得（名称でなくコード。都道府県 JSON をバッチ取得）
- [x] 一括取得＋TTLキャッシュ（学校単位でリクエストしない / §33）
- [x] 取得失敗時は例外 → 上位で `UNKNOWN`（§51）
- [x] 気象庁レスポンス構造の調査（JMA_ADAPTER.md §2 に記録）

**完了条件**: 地域コード配列を渡すと `Warning[]` が返る。JMA固有構造は Domain に漏れない。単体テストあり。
→ **達成**（parse 8 + provider 6 テスト green / 実 API スモーク OK / typecheck OK）

**依存**: なし（最優先）

---

## M2. Rule Engine（PRD §14, §27〜§30 / Phase 2）

**目的**: 地域 + 警報種類 → 判定結果 `CheckResult`（+ 判定根拠）。

> 📄 **詳細仕様確定済み**: [backend/RULE_ENGINE.md](./backend/RULE_ENGINE.md)
> （型設計 / 確定シグネチャ / アルゴリズム / エッジケース / テストマトリクス T1〜T13 / TDD ステップ）

- [x] `@yasumi/shared`: `RuleCondition` / `School` / `SchoolRule` / `EvaluationResult` 型を追加
- [x] `domain/rule/evaluate.ts`: `evaluateSchoolRule({ school, rule, activeWarnings }): EvaluationResult`（純粋関数）
- [x] MVP判定: 対象地域いずれか AND 対象警報いずれか（§29 OR判定）+ 判定根拠 `matchedWarnings` を返す
- [x] 将来の複雑ルール（§30）を見据えた `RuleCondition` 判別ユニオン設計（型のみ、実装しない）

**完了条件**: 判定例（§28）を含むテストマトリクス（T1〜T13）が green。DB・ネットワーク・時刻に非依存。→ **達成**（13 テスト green / typecheck OK）

**依存**: 既存 `@yasumi/shared`（`CheckResult` / `Warning`）のみ。M1 と**並行着手可能**。

---

## M3. DB / Drizzle（PRD §38〜§47 / Phase 3）

**目的**: School / Area / Rule / Subscription 等を永続化。

> 📄 **詳細仕様確定済み**: [backend/DB.md](./backend/DB.md)

- [x] `infrastructure/db/schema.ts`: Drizzle スキーマ（全10テーブル）
- [x] UNIQUE制約: `warning_checks`(§35) / `notifications`(§36)
- [x] マイグレーション生成・適用フロー（`drizzle.config.ts` / `migrate.ts` / `make migrate` / `make generate`）
- [x] リポジトリ層（users/schools/areas/school-config/rules/subscriptions/warning-checks/notifications）
- [x] `areas` の初期データ投入（気象庁 class20s コード / 兵庫県阪神地域 / `make seed`）

**完了条件**: マイグレーションが通り、各リポジトリの CRUD が結合テストで動く。
→ **達成**（migrate/seed OK・結合スモークで CRUD + UNIQUE 冪等 §35/§36 + Rule Engine 連携を確認）

**依存**: なし（M1/M2 と並行可）

---

## M4. API + LIFF 認証（PRD §21, §37 / Phase 4）

**目的**: LIFF ログイン → User 作成 → 学校検索 → 購読までを API で。

> 📄 **詳細仕様確定済み**: [backend/API.md](./backend/API.md)

- [x] LIFF IDトークンのサーバー側検証ミドルウェア（`lineUserId` を信用しない / §21）
- [x] `GET /api/me`（初回 users + line_accounts 作成）
- [x] `GET /api/schools/:id` / `search?q=`
- [x] `GET /api/areas` / `?prefecture=`
- [x] `GET/POST/DELETE /api/me/subscriptions`
- [x] Frontend: `useLiff` / API クライアント / ホーム(購読一覧)・学校検索・購読画面
- [x] Rate Limit / secure-headers / cors / 入力バリデーション(zod)（§54）

**完了条件**: LIFF 上でログイン → 学校を検索 → 購読でき、DBに反映される。
→ **達成**（API 結合テスト 7 件 green・frontend build/typecheck OK。LIFF 実機は要 LINE 環境）

**依存**: M3（DB）

---

## M5. 学校登録 UI + API（PRD §13, §23 / Phase 5）

**目的**: 学校名 → 対象地域 → 対象警報 → 判定時刻を登録できる。

- [x] `POST /api/schools` / `PATCH /api/schools/:id`（作成者/管理者のみ / §23）
- [x] `GET/POST /api/schools/:id/rules` / `PATCH,DELETE /api/rules/:id`
- [x] Frontend: 4ステップ登録（基本情報 / 地域複数選択 / 警報複数選択 / ルール）
- [x] **`check_time` は30分刻み（HH:00 / HH:30）に制限**（UI select + API zod 正規表現）
- [x] 学校編集権限チェック（`authz.ts` / 作成者 or 管理者 §23）

**完了条件**: 未登録学校を新規登録し、地域・警報・30分刻みルールまで保存できる。
→ **達成**（API 結合テストで作成/30分検証/権限403/削除を確認・frontend build OK）

**依存**: M4（認証・User）、M3（DB）

---

## M6. LINE Push（PRD §18, §19, §50, §52 / Phase 6）

**目的**: 判定結果を LINE Messaging API で通知できる。

> 📄 **詳細仕様確定済み**: [backend/LINE.md](./backend/LINE.md)

- [x] `infrastructure/line/`: Push 送信 / Webhook 署名検証（§54）
- [x] `NotificationProvider` 抽象 + `LineNotificationProvider`（§50）
- [x] 通知文面: 午前休 / 全日休校 / UNKNOWN（§18, §52）
- [x] 通知条件: NORMAL は通知しない（`shouldNotify` §19）
- [x] `POST /api/webhooks/line`（署名検証・最小実装）

**完了条件**: 任意の User へ判定結果の Push を送れる。署名検証が効いている。
→ **達成**（provider/メッセージ/署名 のテスト green・Webhook ルート 401/200 確認）

**依存**: M4（User / line_accounts）

---

## M7. Cron 判定パイプライン（PRD §26, §34〜§36, §57 / [CRON.md](./backend/CRON.md) / Phase 7）

**目的**: 30分ごとに自動で判定 → 保存 → 通知が回る。

- [x] `POST /api/internal/run-check`（内部トークン認可 / §54）
- [x] 判定パイプライン（§57）: 該当ルール検索 → 警報一括取得 → 評価 → warning_checks 保存 → Subscription → Push → notifications 保存
- [x] `cron.ts`: `startCron(app)` で毎時 :00 / :30 に `app.fetch` 発火
- [x] in-flight guard（多重発火防止）/ graceful shutdown で `stop()`
- [x] 判定の確定性（§34）: 発火時点の事実を保存し後で変えない（保存済み result を通知に採用）
- [x] 冪等性検証: 再起動・重複発火でも二重にならない（§35, §36）
- [x] JST 基準の時刻・`target_date` 処理（`shared/jst.ts`）
- [x] `GET /api/schools/:id/status` / `history`（ホーム画面用）

**完了条件**: MVP完成シナリオ（§59）が通る —
購読済み学校で、朝の判定時刻に警報があれば「午前休」の LINE 通知が届く。
→ **達成**（HTTP 経路の E2E で run-check→AM_OFF 通知→status 反映を確認・冪等/UNKNOWN もテスト green）

**依存**: M1, M2, M3, M6（全て）

---

## M8. デプロイ / 一般公開（PRD §58 Phase 8）

**目的**: 本番運用開始。

> 📄 **手順書**: [DEPLOY.md](./DEPLOY.md)

- [x] `docker/api.Dockerfile`（oven/bun 2ステージ / `bun run src/server.ts`）
- [x] Frontend ビルド配信方針を確定（Cloudflare Pages / docker SPEC §6・DEPLOY §5）
- [x] 免責表示の常設（§53 / フッター + 通知文面）
- [x] 本番イメージのコンテナ E2E 確認（health / migrate / seed / run-check / 実 JMA 取得）
- [ ] Cloudflare Tunnel 設定（api のみ公開）※要インフラ環境
- [ ] LINE 公式アカウント / LIFF / リッチメニュー（§20）設定 ※要 LINE 環境
- [ ] 本番 `.env` / Secret 管理 / DB バックアップ運用 ※要インフラ環境
- [ ] 実ユーザーでの動作確認 → 一般公開 ※要 LINE 環境

**完了条件**: 本番環境で §59 のシナリオが実ユーザーで成立する。
→ コードは完成。残るはインフラ/外部サービス設定（DEPLOY.md 手順に沿って実施）。

---

## 依存関係マップ

```text
M0 ─┬─ M1 ─┐
    ├─ M2 ─┤（M1/M2/M3 は並行可）
    └─ M3 ─┴─ M4 ─┬─ M5 ─┐
                   └─ M6 ─┴─ M7 ─ M8
```

- **並行可能**: M1 / M2 / M3 は独立して着手できる（芯とDBは疎）。
- **クリティカルパス**: M0 → M3 → M4 → M6 → M7 → M8。

---

## MVP スコープ外（PRD §5, §30, §60）

以下は MVP（Part 1）に含めない（将来機能として記録）:
警報解除の扱い / 特別警報即休校 / 台風・大雪・交通機関 / 複雑な AND ルール /
編集提案・承認フロー / 複数学校切替の高度化 /
Web Push・Discord・Email 通知 / 通常登校通知の設定 UI。

> ただし拡張点（`NotificationProvider` 抽象・Rule Engine の型設計）は
> MVP 時点で"差し込める形"にしておく。

> **有料プラン**は当初 MVP スコープ外だったが、**Part 2（M11〜）で正式に着手**する。

---

# Part 2 — 収益化ロードマップ（学校向けSaaS）

> 事業方針: メモリ `monetization-plan`（2サイド／学生無料死守／私立×校内密度）。
> MVP設計: [docs/plans/2026-09-10-school-saas-mvp.md](./docs/plans/2026-09-10-school-saas-mvp.md)。
> 営業LP: `landing/src/pages/for-schools.astro`。

## 本番反映状況（2026-09-11）

**M9〜M14 すべて本番反映済み**（PR #30 / product）。api・admin・landing・frontend・**school** の5サービス稼働。
- パッケージ取得は **公開npm**（`npm.flatt.tech` ミラーは fresh install のレート制限で使わない・`bunfig.toml` で固定）。
- 先生ダッシュボード(school) は host `:8085` で起動。**外部公開には Cloudflare Tunnel `yasumi-school.unischool.jp → :8085` と `.env` の `SCHOOL_JWT_SECRET` / `VITE_SCHOOL_API_BASE_URL` 設定が必要**（未設定の間 `/api/school` は無効）。
- 残TODO: 上記トンネル/secret、for-schools LP の「開封→到達」表現修正、学生グロース施策。

## 収益化の芯（前提）

- **2サイドモデル**: 利用者＝学生/保護者（**無料・死守**）、課金者＝学校（特に**私立**）。学生機能は一切ペイウォールしない。
- **課金の線引き**: 警報連動・休校・緊急連絡は全有料プランで**無制限**。任意の「お知らせ」だけプランごとに通数制限。
- **本格着手トリガー**: ユーザー100人超。ただし「全体100人」より**1校あたりの密度**（1校30〜50人）で判断。
- **最初の顧客**: 私立学校の直販・高タッチ（三田学園 ほか）。だから**セルフサーブ課金は作らず、手動プロビジョニング＋請求書**から。

## マイルストーン全体像（Part 2）

```text
M9  無料プロダクト強化 / 通知コスト対策（native FCM 継ぎ目）   … 実装済み（デバイスビルドは外部作業）
M10 学校向け営業基盤（営業LP＋校内密度パネル）                … 実装済み（develop・未デプロイ）
      ↓
M11 [Phase 0] テナント基盤（teachers＋認証＋plan）           ← 次の着手点
      ↓
M12 [Phase 1] 先生ダッシュボード（別アプリ・公式送信＋到達＋購読者）
      ↓
M13 [Phase 2] 欠席受付（LIFFフォーム＋受信箱＋警報自動タグ＋plan gate）
      ↓
M14 [Phase 3] 通数カウンタ／請求運用の型／(後で)Stripe・生徒↔保護者紐付け
```

**クリティカルパス**: M11 → M12 → M13。M14 は需要を見てから。各マイルストーン完了時に develop へ commit、
本番反映は**都度ユーザー承認**（PII を扱う M13 は特に、マージ前に security-review スキル必須）。

---

## M9. 無料プロダクト強化 / 通知コスト対策

**目的**: グロースの土台と、ユーザー増で効いてくる LINE プッシュ従量課金への備え。

- [x] ネイティブアプリ版の継ぎ目（Capacitor / FCM HTTP v1・無料プッシュ）。`device_tokens` テーブル、
      デバイストークンあれば FCM / 無ければ LINE の送り分け（`run-check` / `dispatch`）。認証プロバイダ抽象化（`frontend/src/lib/auth/`）
- [x] Google Analytics（LP: G-KD1JVMNV44 / App: G-0ZDZHLJ7QM）
- [x] Admin ユーザー管理強化（プロフィール表示・簡易メッセージ送信・購読編集・学校購読者一覧・一斉送信）
      → [docs/plans/2026-09-10-admin-user-management.md](./docs/plans/2026-09-10-admin-user-management.md)
- [ ] **デバイスビルド（外部作業）**: Firebase サービスアカウント鍵、APNs 認証キー、Xcode/Android Studio、
      LINE ネイティブログイン channel secret。`native/README.md` 参照。ストア審査。
- [ ] 学生グロース施策（新入生向けシェア導線＝校内密度を作る撒き餌）※未着手

**状態**: コードは実装済み・本番稼働。ネイティブの端末ビルドはユーザー側の外部設定待ち。

---

## M10. 学校向け営業基盤

**目的**: 「御校の生徒◯人に公式で届く」と数字で売るための、営業面と数字面。

- [x] **校内密度パネル**（営業指標）: `schools.student_count`、`GET /api/admin/schools/overview`
      （学校ごと購読者数/通知ON数/生徒数を購読多い順）、管理画面「浸透率（営業）」ページ（浸透率バー・商談化/有望チップ）。commit `a7aaf11`
- [x] **学校向け営業LP** `/for-schools`（課題→解決→機能→導入→料金→FAQ→CTA / 問い合わせ `unischool@sandagakuen.ed.jp`）。
      Problem セクションは Google Workspace 風にリデザイン。commit `a28cb35`〜
- [ ] LP の「開封」表現を「到達」へ修正（**本番前 TODO**・LINE/FCM で開封は取得不可）
- [ ] 本番反映（develop→product・要デプロイ承認）※保留中

**状態**: develop に実装済み・**未デプロイ**。

---

## M11. [Phase 0] テナント基盤 — teachers ＋ 認証 ＋ plan  ✅ 実装済み（develop）

> 📄 [docs/plans/2026-09-11-m11-tenant-foundation.md](./docs/plans/2026-09-11-m11-tenant-foundation.md)

**目的**: 学校を「テナント」として扱い、教員アカウントが**自校だけ**を触れる土台。社内adminが手で開通できる。

- [x] `teachers` テーブル（`{ id, schoolId, email, passwordHash, role(owner|teacher), name, disabled, createdAt }`）＋マイグレーション `0004`
- [x] 教員認証（`api/school/auth.ts`・HS256・`teachers` 系統）＋社内adminが初期PW発行
- [x] **テナントミドルウェア**（`teacherAuthMiddleware`）: トークンの `schoolId` を固定し自校のみ。teachers repo は `schoolId` 必須の関数（`findTeacherInSchool`/`deleteTeacherInSchool`）で越境防止
- [x] `schools` に `plan`（basic|standard|premium|null）・`planExpiresAt` を追加
- [x] `api/school/app.ts`（`/api/school` = login・/me）＋ `SCHOOL_JWT_SECRET` で有効化
- [x] 社内 admin に「教員アカウント発行/無効化/削除・プラン設定・有効期限」（admin API＋SchoolDetail UI）

**完了条件**: 社内adminが学校Aに教員アカウントとpremiumプランを付与でき、そのアカウントで
ログインすると学校Aのデータだけが見える。→ **達成**（DB-gated 結合テスト 5件 green・全体 85 pass）

**依存**: 既存 `schools` / admin 認証基盤。

---

## M12. [Phase 1] 先生ダッシュボード（別アプリ）  ✅ 実装済み（develop）

> 📄 [docs/plans/2026-09-11-m12-teacher-dashboard.md](./docs/plans/2026-09-11-m12-teacher-dashboard.md)

**目的**: 先生が自校の公式連絡を送り、届いたかを見て、購読者を把握できる。

- [x] 新フロント `school/`（workspace・Vite+React19+MUI・緑テーマ）。compose に追加・host `:8085`・**本番反映済み**。別ドメイン `yasumi-school.unischool.jp`（Cloudflare Universal SSL は1段のみ→`yasumi-` 単段）／トンネル・secret は要設定
- [x] 教員ログイン（M11 の認証・email+password）
- [x] **公式メッセージ送信** `POST /api/school/broadcast`（`notifyUser` 経路・自校スコープ・category 緊急/お知らせ）
- [x] **到達状況** `school_messages` に記録（total/sent/failed）＋ `GET /messages` 履歴。※開封は取得不可
- [x] **購読者一覧** `GET /api/school/subscribers`（自校スコープ）

**完了条件**: 教員が別アプリからログイン → 自校購読者へ公式メッセージを送信 → 到達件数が履歴に出る。
→ **達成**（migration `0005`・DB-gated 送信/記録/購読者/テナントスコープ テスト green・全86 pass・school build green）

**依存**: M11。

---

## M13. [Phase 2] 欠席受付（プレミアムの目玉）  ✅ 実装済み（develop）

> 📄 [docs/plans/2026-09-11-m13-absence-reception.md](./docs/plans/2026-09-11-m13-absence-reception.md)
> ⚠️ **PII**（生徒名・健康理由）を扱う。テナントスコープ厳守。

- [x] `student_profiles` / `absence_reports`（migration `0006`。linkToken 等は Phase3+ 予約）
- [x] **LIFF**: `student_profile` 登録＋「欠席を連絡」フォーム（frontend `AbsenceReport.tsx`・premium校のみ導線 `showAbsence`）
- [x] 送信時に**警報有無を自動判定**（`warning-checks.hasActiveWarningOnDate`）→ `warningActive` 記録
- [x] 先生ダッシュボード**受信箱（未読/確認済み）＋「要確認（警報なし休校）」タブ**（school `Absences.tsx`）
- [x] **plan gate**: `domain/plan.ts` の `absenceEnabled`（premium 有効）。非premium は 403＋LIFF導線非表示
- [x] **security-review 実行**: High=0。Med 1件（無効化教員のトークンが最大12h有効）→ **修正済み**（`teacherAuthMiddleware` で毎リクエスト DB 再検証・削除/無効化を即失効）

**完了条件**: premium 校で欠席送信 → 先生受信箱に**自校のみ**表示・確認済み化・警報なし休校を監視タブに。他校の欠席は不可視。
→ **達成**（DB-gated: premiumゲート/警報自動タグ/テナント越境404/トークン即失効 テスト green・全87 pass・frontend/school build green）

**依存**: M11, M12, 既存 `warning_checks`。

---

## M14. [Phase 3] 通数・請求運用（Stripe/紐付けは対象外）  ✅ 実装済み（develop）

> 📄 [docs/plans/2026-09-11-m14-message-quota.md](./docs/plans/2026-09-11-m14-message-quota.md)
> ユーザー指示により **Stripe は今回対象外**。生徒↔保護者クロス紐付け（linkToken）も Phase3+ の任意扱いで今回見送り。

- [x] 任意送信の**月間通数カウンタ**: `domain/plan.ts` `announcementMonthlyLimit`（basic10/standard50/premium無制限）＋`jstMonthStart`、`countAnnouncementsSince`
- [x] `POST /api/school/broadcast`: お知らせが上限到達で 403（緊急/休校は無制限）。`GET /api/school/quota`（used/limit）
- [x] school ダッシュボード: お知らせ残数表示・上限到達で送信不可＋案内
- [x] 請求書運用の型: M11 の手動 plan/`planExpiresAt`（社内admin）で対応
- [ ] Stripe（カード自動）… **対象外（今回やらない）**
- [ ] 生徒↔保護者 linkToken 紐付け … **対象外（Phase3+・需要次第）**

**完了条件**: basic 校でお知らせ10通→11通目が 403、緊急は無制限、`/quota` が used/limit を返す。
→ **達成**（DB-gated テスト green・全88 pass・school build green）

**依存**: M11〜M13。

---

## 段階リリースと KPI

| フェーズ | ゲート / KPI |
|---|---|
| M10 まで | 1校あたり密度（浸透率）を上げる。**1校で30〜50人**を最初の商談化ライン |
| M11〜M13 | **私立1校**を有料（請求書）で開通し、公式送信＋欠席受付を実運用（PMF検証） |
| M14 | 契約が増えてきたら通数課金・Stripe・紐付けを追加 |

**運用ルール（厳守）**:
- 本番デプロイ（develop→product PR マージ）は**都度ユーザー承認**。
- M13 は PII を扱うため、**マージ前に security-review スキルを必ず実行**。
- リポジトリは公開。**秘密情報・インフラ構成・IP は絶対にコミットしない**。
