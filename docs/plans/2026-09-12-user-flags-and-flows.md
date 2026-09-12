# ユーザーフラグ ＋ フロー（簡易オートメーション）設計プラン

作成日: 2026-09-12
種別: 設計ドキュメント（実装未着手。ユーザー指示によりまず設計のみ）

## Context / ゴール
管理画面で、ユーザーに**フラグ（タグ）**を付け、それを条件に**複数ステップのフロー**（対象を絞る→送信→フラグ付与…）を
組んで実行できるようにする。狙いは「未アプローチ層への一括施策」等の運用自動化。
確定事項（2026-09-12）: **まず設計のみ**／**フロー実行は必ず実行前に件数確認**（誤送信防止）。

例（達成したい体験）:
```
対象: フラグ「送信済み」なし かつ 未購読
 step1: テンプレート「初回案内」を送信
 step2: フラグ「送信済み」を付与
→ 実行前に「対象 N 名／各ステップ」を確認 → 実行 → 件数レポート
```

---

## 機能1: ユーザーフラグ（タグ）
### データモデル
- `flag_defs { name varchar PK, color varchar null, created_at }` … フラグ定義（選択肢の元）
- `user_flags { user_id uuid, name varchar, created_at, PK(user_id, name) }` … 付与（多対多）
### backend（/api/admin）
- `GET/POST/DELETE /flag-defs`（定義の一覧/作成/削除）
- `POST /flags/assign { userIds: string[], name }` / `POST /flags/unassign { userIds, name }`（一括付与/解除）
- `listUsers` の各行に `flags: string[]` を含める（`user_flags` を集約）。ユーザー詳細にも表示。
### admin UI
- フラグ定義の管理（作成/削除・色）。ユーザー一覧/詳細でフラグ表示・個別付与/解除。
### 条件エディター連携（既存 `UserQueryEditor`）
- フィールドに **`flag`** を追加。演算子 `hasFlag`（を持つ）/ `notHasFlag`（を持たない）、値＝フラグ名（defs から選択）。
- 評価 `matchesQuery` に flag 判定を追加（`user.flags.includes(name)`）。

## 機能2: フロー（簡易オートメーション）
### フロー定義（MVP・その場実行。保存は Phase2）
```
Flow {
  audience: UserQuery         // 条件エディターで指定（フラグ条件も使える）
  steps: Step[]               // 上から順に実行
}
Step =
  | { type: "send", templateId?: string, text: string }
  | { type: "addFlag", name: string }
  | { type: "removeFlag", name: string }
  // 将来: subscribe/unsubscribe, wait 等
```
### 実行モデル（MVP: クライアント・オーケストレーション）
- 対象 userIds は**実行開始時にスナップショット**（audience を1回評価して固定）→ 全ステップが同じ集合に適用（例の「送信→送信済み付与」が正しく回る）。
- 各ステップは既存/新規APIを順に呼ぶ:
  - send → `POST /admin/broadcast { text, target:{type:"users", userIds} }`（既存）
  - addFlag/removeFlag → `POST /admin/flags/(un)assign { userIds, name }`（新規）
- サーバに複雑なクエリエンジンを持たせない（audience評価は admin 側の `matchesQuery` を再利用）。
### 実行前の安全弁（必須）
- 実行ボタン → **プレビューダイアログ**：`対象 N 名` ＋ 各ステップ（送信文面の先頭・付与/解除するフラグ）を表示 → 確認して初めて実行。
- 実行後は**ステップごとの結果**（送信 sent/total、付与件数 等）を表示。
### admin UI（フロービルダー・モーダル）
- 上部：対象＝「条件エディターを開く」（既存モーダル流用）＋ 対象件数プレビュー。
- 下部：ステップをブロックで積む（＋送信 / ＋フラグ付与 / ＋フラグ解除、↑↓並べ替え・✕削除）。Scratch風の見た目を踏襲。
- 「実行（確認あり）」ボタン。

## スケール / 制約（MVP）
- MVP は admin に読み込んだユーザー集合で動作。現在 `listUsers` は limit 200 → **limit を 1000 程度に引き上げ**て当面対応。
- broadcast(users) は 1回 500件上限。超える場合は分割送信 or Phase2 のサーバ側バッチ。
- 大規模・厳密性が必要になったら Phase2 でサーバ側 audience 解決＋バッチ実行に移行。

## Phase 分け
- **Phase 1（MVP）**: フラグ（defs/assign/条件/一覧表示）＋ その場実行の線形フロー（対象→send/addFlag/removeFlag）＋実行前件数確認。
- **Phase 2**: フローの**保存・再利用**（`flows { id, name, spec jsonb }`）、**定期実行（cron）**、サーバ側 audience 解決＋バッチ、実行履歴（`flow_runs`）。

## 検証
- DB-gated: flag defs CRUD / assign・unassign（冪等）/ listUsers に flags 反映 / broadcast(users) は既存。
- admin: 条件エディターの flag 条件で絞り込み、フロー実行で「送信→フラグ付与」が対象スナップショットに適用され、2回目実行では対象が0（フラグで除外）になること。
- 実行前プレビューの件数が実結果と一致。

## 留意
- 誤送信防止：実行前確認（必須）＋対象0なら実行不可＋送信系は確認文言に件数明記。
- フラグ名は defs 管理（自由文字も可だが、条件・フローで使うため定義推奨）。
- 破壊的操作（フラグ一括解除等）も確認を挟む。
- 関連: 既存 `UserQueryEditor`（条件ブロック）、`admin_message_templates`（定型文）、broadcast(users)。
