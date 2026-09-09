# 変更成功トースト & フロント学校編集タブ 実装プラン

作成日: 2026-09-09

## 背景 / 要望

1. **変更成功時のトースト/アラート**: admin 管理画面で保存・追加・削除などの変更が成功しても
   フィードバックが無い。成功/失敗時に toast（Snackbar）を出す。
2. **フロント学校編集タブ**: LIFF ミニアプリで「自分が作った学校」を後から編集できるタブを追加する。

## 現状

- backend は既に `PATCH /api/schools/:id`・`POST/PATCH/DELETE /api/(schools/:id/)rules` を
  **作成者/管理者のみ**（`checkSchoolEditable`）で提供済み。→ 編集用 API はほぼ揃っている。
- frontend の ApiClient は `createSchool`/`createRule` のみ。「自分の学校一覧」取得手段が無い。
- frontend App は既に成功トースト（Snackbar）を持つ（`snack`/`onNotify`）。tab は home/search の2つ。
- admin にはトースト機構が無い。各ページの mutation `onSuccess` は invalidate のみ。

---

## Part A: admin トースト（成功/失敗フィードバック）

### A-1. トースト機構
- `admin/src/components/Toast.tsx` を新規作成。
  - `ToastProvider`（Context）＋ `useToast()` フック。
  - MUI `Snackbar`+`Alert` を1つ描画。`toast.success(msg)` / `toast.error(msg)`。
  - autoHideDuration 3000、右下 anchor。
- `admin/src/main.tsx` で `RouterProvider` を `ToastProvider` でラップ（全ルートの祖先）。

### A-2. 各ページの mutation に配線
- `SchoolDetail.tsx`: save→「保存しました」/ addRule→「ルールを追加しました」/ delRule→「ルールを削除しました」。onError→`toast.error`。
- `Areas.tsx`: create→「地域を追加しました」/ del→「地域を削除しました」。
- `Admins.tsx`: create→「管理者を追加しました」/ patch→「更新しました」。

---

## Part B: フロント「編集」タブ（自分の学校の後編集）

### B-1. backend: 自分の学校一覧
- `repositories/schools.ts`: `listSchoolsByCreator(db, userId)` を追加（`createdBy = userId`、新しい順）。
- `api/app.ts`: `GET /api/me/schools` を追加（`c.get("userId")` の作成学校を返す）。

### B-2. frontend api クライアント
- `api/client.ts`: `listMySchools()`, `updateSchool(id, patch)`, `updateRule(id, patch)`, `deleteRule(id)` を追加。
- `api/types.ts`: 既存 `SchoolSummary`/`SchoolDetail` を流用。
- `api/mock-client.ts`: 追加メソッドをモック実装（ApiClient 型維持のため必須）。

### B-3. frontend UI
- `App.tsx`: bottom nav に3つ目のタブ「編集」（EditIcon）を追加。`Tab = "home" | "search" | "manage"`。
  `View` に `{ kind: "edit"; schoolId }` を追加。
- `pages/MySchools.tsx`（新規）: `listMySchools()` の一覧。タップで `onEdit(schoolId)`。空表示あり。
- `pages/EditSchool.tsx`（新規）: `getSchool(id)` を読み込み、学校名/市区町村/公式サイト/
  対象地域（AreaBlocksPicker）/対象警報（Chips）を編集し `updateSchool` で保存。
  判定ルールは一覧＋追加（`createRule`）＋削除（`deleteRule`）を即時反映。保存・追加・削除で `onNotify` トースト。
  「戻る」で manage タブへ。

---

## 検証

- `bun run typecheck`（frontend / admin / backend）、`bun test`（backend: /me/schools 追加分）。
- frontend `vite build`、admin `vite build`。
- モック（VITE_MOCK=1）で編集タブの表示を確認。

## コミット

- Part A（admin toast）と Part B（frontend edit + backend endpoint）で分割コミット。Co-Authored-By は付けない。
