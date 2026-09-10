# M13 [Phase 2] 欠席受付（双方向・プレミアムの目玉） 実装プラン

作成日: 2026-09-11
親: [2026-09-10-school-saas-mvp.md](./2026-09-10-school-saas-mvp.md) / ROADMAP M13 / 前: M11, M12

> ⚠️ **PII**（生徒名・欠席理由）を扱う。テナントスコープ厳守。実装後に **security-review スキル必須**。

## データモデル
```
student_profiles { id, schoolId, ownerUserId, studentName, grade, className("class"回避), linkToken?, linkedStudentUserId?, createdAt }
  ※ linkToken/linkedStudentUserId は Phase3+ 予約・MVP未使用
absence_reports { id, schoolId, studentProfileId, reportedByUserId, date, type(欠席|遅刻|早退|休校),
                  reason, note?, warningActive(自動), status(unread|confirmed), createdAt }
```

## plan ゲート
`domain/plan.ts`: `isPlanActive(school, now)`（plan!=null かつ 期限内）/ `absenceEnabled(school, now)`（active かつ plan==='premium'）。

## 休校の正当性（自動タグ）
`warning-checks` repo に `hasActiveWarningOnDate(db, schoolId, date)` を追加。
欠席送信時に `warningActive` を自動記録。type='休校' で warningActive=false は監視対象。

## backend
### LIFF（`/api/me` スコープ・authMiddleware）
- `GET /me/student-profiles` … 自分の生徒プロフィール一覧
- `POST /me/student-profiles` … `{schoolId, studentName, grade, className}` 作成（ownerUserId=自分）
- `GET /me/absence-schools` … 自分の購読校のうち premium 有効な学校（欠席を出せる先）
- `POST /me/absence-reports` … `{schoolId, studentProfileId, date, type, reason, note?}`
  - profile が自分のもの & profile.schoolId==schoolId を検証、school が absenceEnabled かを検証（不可なら403）
  - `warningActive` を自動判定して記録
- `GET /me/absence-reports` … 自分が出した欠席（確認用）

### 先生ダッシュボード（`/api/school`・teacher.schoolId スコープ）
- `GET /absences?status=&flagged=` … 自校の欠席一覧（profile 結合で氏名・学年組）。flagged=警報なし休校
- `PATCH /absences/:id` … `{status:'confirmed'}`（report.schoolId==teacher.schoolId のみ）

## frontend
- **LIFF（frontend/）**: 「欠席を連絡」フロー（premium校のみ導線）。生徒プロフィール登録（1回）→ 欠席フォーム（日付・種別・理由）。
- **先生ダッシュボード（school/）**: 「欠席受付」受信箱（未読/確認済みタブ・要確認=警報なし休校）＋確認済みトグル。

## テナント境界（最重要）
- 欠席の閲覧/更新は `teacher.schoolId` のみ。他校の欠席は 404。
- 生徒プロフィールは ownerUserId 本人のみ。欠席作成は profile 所有権＋school一致＋premiumを検証。

## 完了条件
premium校で保護者/生徒が欠席送信 → 先生ダッシュボード受信箱に**自校のみ**表示、確認済みにできる。
警報なし休校が監視タブに出る。他校の欠席は一切見えない。**security-review 実行**。

## 検証
- `bun test`（DB-gated）: premium時のみ欠席作成可（非premium→403）/ warningActive 自動タグ /
  他校トークンで欠席が見えない / status 更新 / profile 所有権。
- `bun run typecheck` / school・frontend build。
- **security-review スキル**（PII・テナント越境）。
