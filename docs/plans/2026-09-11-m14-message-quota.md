# M14 [Phase 3] 任意送信の月間通数カウンタ（Stripe除外） 実装プラン

作成日: 2026-09-11
親: ROADMAP M14 / 前: M11〜M13
※ ユーザー指示により **Stripe は今回対象外**。生徒↔保護者クロス紐付け（linkToken）も当初から Phase3+ の任意扱い＝今回見送り。

## 目的
「お知らせ」（任意送信）にプラン別の**月間通数上限**を効かせる。警報連動・緊急（emergency）は無制限のまま。
請求書運用は M11 の手動 plan/期限で足りるため、ここは通数制御が主。

## プラン別・月間お知らせ上限
| plan | announcement/月 | emergency |
|---|---|---|
| null（無料/未契約） | 0 | 0（送信自体できない＝購読者送信は有料前提。実運用上 emergency も plan前提） |
| basic | 10 | 無制限 |
| standard | 50 | 無制限 |
| premium | 無制限 | 無制限 |

## backend
- `domain/plan.ts`:
  - `announcementMonthlyLimit(plan): number | null`（null=無制限）
  - `jstMonthStart(now): Date`（JST 当月1日 00:00 の UTC 時刻）
- `repositories/school-messages.ts`: `countAnnouncementsSince(db, schoolId, since): number`
- `api/school/app.ts`:
  - `POST /broadcast`: category==='announcement' のとき当月使用数を数え、上限到達なら 403（`quota exceeded`）
  - `GET /quota`: `{ plan, announcement: { used, limit } }`（limit=null は無制限）

## frontend（school/）
- Dashboard: お知らせ選択時に「今月 used/limit」を表示。上限到達なら送信ボタン無効化＋案内。

## 完了条件
basic 校でお知らせを上限（10通）送ると 11通目が 403。emergency は上限に関係なく送れる。`GET /quota` が used/limit を返す。

## 検証
- `bun test`（DB-gated）: announcement 上限で 403 / emergency は無制限 / GET /quota。
- typecheck・school build。
