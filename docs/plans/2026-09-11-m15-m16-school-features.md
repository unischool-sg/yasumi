# M15/M16 学校向け機能拡張（テンプレート＋確認ボタン／警報連動の休校ドラフト）

作成日: 2026-09-11
親: ROADMAP Part 2 / 前: M11〜M14

ユーザー選択（2026-09-11）: **テンプレート＋確認ボタン** と **警報連動の休校ドラフト** を実装。

## M15-A テンプレート
- `message_templates { id, schoolId, title, category('emergency'|'announcement'), body, createdAt }`（自校スコープ）
- school API: `GET/POST/DELETE /api/school/templates`
- ダッシュボード送信フォームに「テンプレから挿入」。数個の組み込みプリセット（フロント定数）＋DB保存分をマージ。

## M15-B 確認ボタン（確認率）
「開封」は取れないので**リンククリック＝確認**で代替（LPの到達→確認も実現）。LIFF非依存で、
バックエンドが署名トークン付きの確認URLをメッセージ末尾に**受信者ごと**に付与する方式。
- `school_messages.requireConfirmation boolean`（送信時に付けるか）
- `message_confirmations { messageId, userId, confirmedAt, PK(messageId,userId) }`
- 送信ループで受信者ごとに `text + "\n\n▼確認: <apiBase>/c/<token>"`、token=`sign({m,u}, schoolJwtSecret, HS256)`
- 公開EP `GET /c/:token`（認証不要）: 検証→confirmations upsert→簡易HTML「確認を受け付けました」
- `GET /api/school/messages` に `confirmedCount` を追加（確認率=confirmedCount/total）
- ダッシュボード: 送信フォームに「確認を依頼する」チェック、履歴に確認数表示
- deps: `apiBaseUrl`（env `API_PUBLIC_BASE_URL`、既定 `https://yasumi-api.unischool.jp`）。未設定でもフォールバックで動く。

## M16 警報連動の休校ドラフト
警報で休校系の判定が出た学校に、**公式休校連絡の下書き**を自動生成→先生がワンタップ送信。
- `closure_drafts { id, schoolId, date, result, text, status('pending'|'sent'|'dismissed'), createdAt, unique(schoolId,date) }`
- run-check パイプラインのフック: プラン有効な学校で closure 系結果（WAIT/AM_OFF/PM_START/FULL_OFF）が出たら
  `upsertPendingDraft`（同日重複は作らない）。テキストは `buildClosureDraftText(result, warnings)` で生成。
- school API: `GET /api/school/drafts`（pending）、`POST /api/school/drafts/:id/send`（→emergency broadcast＋sent）、
  `POST /api/school/drafts/:id/dismiss`
- ダッシュボード: 未処理ドラフトを上部に大きく表示（本文編集可・送信/却下）。

## テナント/PII/課金
- 全 school API は `teacher.schoolId` スコープ。ドラフトは plan 有効校のみ生成。
- 確認は個人特定を含むが学校スコープ内の集計のみ。トークンは HS256 署名で改ざん不可。

## 検証
- `bun test`（DB-gated）: templates CRUD 自校スコープ / 確認トークン発行→/c→confirmedCount / draft 生成(closure時のみ・重複なし)→send/dismiss・テナント越境不可。
- `bun run typecheck`、school/frontend build。
