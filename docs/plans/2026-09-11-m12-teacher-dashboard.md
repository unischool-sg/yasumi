# M12 [Phase 1] 先生ダッシュボード（別アプリ） 実装プラン

作成日: 2026-09-11
親: [2026-09-10-school-saas-mvp.md](./2026-09-10-school-saas-mvp.md) / ROADMAP M12 / 前: M11

## 目的
教員が自校の**公式メッセージを送信**し、**到達状況**を見て、**購読者**を把握できる。別アプリ `school/`。

## backend（`/api/school`）

1. **schema**: `school_messages { id, schoolId, teacherId, category('emergency'|'announcement'), text, total, sent, failed, createdAt }`
   （到達履歴＝到達状況の可視化。将来 M14 の任意送信通数カウントもこの category='announcement' から集計）
2. **migration**（drizzle-kit generate）
3. **repo** `school-messages.ts`: `createMessage` / `listBySchool`（新しい順）
4. **`SchoolAppDeps`** に `notificationProvider?` / `pushProvider?` を追加（`createApp` から注入）
5. **EP**（すべて `teacher.schoolId` スコープ。リクエストの schoolId は受け取らない）:
   - `GET /subscribers` … 自校購読者一覧（`listSubscribersBySchool`）
   - `POST /broadcast` … `{ text, category: 'emergency'|'announcement' }` → 自校購読者へ `notifyUser` 送信、
     `school_messages` に記録、`{ id, total, sent, failed }` を返す
   - `GET /messages` … 送信履歴（到達状況）

## frontend（新ワークスペース `school/`）
admin を範として最小構成でミラー（Vite+React19+MUI+TanStack Router/Query）。
- 雛形: `package.json`(@yasumi/school) / `vite.config.ts`(port 5175) / `tsconfig.json` / `index.html` /
  `src/main.tsx` / `theme.ts` / `vite-env.d.ts` / `components/Toast.tsx`(admin流用) / `lib/auth.ts`(teacher版)
- `api/client.ts`: teacherLogin / getMe / getSubscribers / broadcast / getMessages
- `pages/Login.tsx`（email+password）/ `pages/Dashboard.tsx`（プラン表示・送信フォーム(category選択)・到達履歴・購読者数）
- `components/Layout.tsx`（自校名・ログアウト）/ `router.tsx`（/login・/）
- root `package.json` workspaces に `school` を追加、`dev:school` スクリプト

## テナント境界
- 全EPで `c.get("teacher").schoolId`。他校データに触れる導線なし。
- クライアントは認証トークンのみ送る（schoolId をクライアントから渡さない）。

## 完了条件
教員が別アプリでログイン → 自校購読者へ公式メッセージ送信 → 到達件数（total/sent/failed）が履歴に出る。
購読者数が見える。DB-gated 結合テストで送信→記録→履歴、テナントスコープを確認。

## 検証
- `bun test`（DB-gated）: `/api/school/broadcast`→`school_messages` 記録→`/messages`、`/subscribers` 自校のみ。
- `bun run typecheck`、school フロント typecheck+build。
