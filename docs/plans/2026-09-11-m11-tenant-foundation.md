# M11 [Phase 0] テナント基盤 — teachers ＋ 認証 ＋ plan  実装プラン

作成日: 2026-09-11
親: [docs/plans/2026-09-10-school-saas-mvp.md](./2026-09-10-school-saas-mvp.md) / ROADMAP M11

## 目的
学校を「テナント」として扱い、教員アカウントが**自校だけ**を触れる土台を作る。社内adminが手で開通できる。
（先生ダッシュボードUI本体は M12。ここは backend の認証・テナント基盤＋admin側プロビジョニングまで。）

## 実装対象

### backend
1. **schema.ts**
   - `teachers { id, schoolId→schools.id, email unique, passwordHash, role('owner'|'teacher'), name, disabled, createdAt }`
   - `schools` に `plan varchar null` / `planExpiresAt timestamptz null`
2. **migration**（`drizzle-kit generate`）
3. **repositories/teachers.ts**: createTeacher / findTeacherByEmail / findTeacherById / listTeachersBySchool / updateTeacher / deleteTeacher
4. **repositories/schools.ts**: `NewSchool` に `plan?` / `planExpiresAt?` を追加（updateSchool の Partial で更新可能に）
5. **api/school/auth.ts**（admin/auth.ts に倣う・別JWT系統）
   - `SchoolEnv = { Variables: { teacher: { id, schoolId, role, email, name } } }`
   - `teacherLogin(db, secret, email, password)` → `{ token, teacher }`（disabled は拒否）
   - `teacherAuthMiddleware(secret)` … Bearer JWT 検証 → `c.set("teacher", …)`。**schoolId をトークンから固定＝テナント境界**
6. **api/school/app.ts**: `createSchoolApp(deps)` を `/api/school` にマウント
   - `POST /auth/login`（rateLimit）
   - `GET /me` … `{ teacher, school: { id, name, prefecture, plan, planExpiresAt } }`
   - ※ 送信/購読者/欠席などの業務EPは M12/M13
7. **api/admin/app.ts**（社内プロビジョニング。admin認証下）
   - `GET /schools/:id/teachers` / `POST /schools/:id/teachers`（email,name,role,password）/ `PATCH /teachers/:id`（role/disabled/password）/ `DELETE /teachers/:id`
   - 学校 PATCH の validator に `plan`（enum basic|standard|premium, nullable）・`planExpiresAt`（datetime nullable）を追加
8. **api/app.ts / server.ts**: `AppDeps.schoolJwtSecret?` を追加。`SCHOOL_JWT_SECRET` 設定時に `/api/school` を有効化

### admin frontend
- `SchoolDetail.tsx`: プラン設定（plan セレクト＋有効期限）＋ 教員アカウント管理カード（一覧・発行・無効化）
- `api/client.ts`: 型（`Teacher`）＋メソッド（getSchoolTeachers/createTeacher/updateTeacher/deleteTeacher、updateSchool に plan/planExpiresAt）

## テナント境界（最重要）
- 教員向けAPIは `c.get("teacher").schoolId` を唯一の真実として使い、リクエストの schoolId は受け取らない/信用しない。
- 他校のデータに触れる導線を作らない（M12以降のEPも同原則）。

## 完了条件
社内adminが学校Aに教員アカウント＋premiumプランを付与でき、そのアカウントでログインすると
`GET /api/school/me` が学校Aとpremiumを返す。他校IDでのlog inや越境は不可。DB-gated 結合テスト green。

## 検証
- `bun test`（DB-gated）: teachers repo / teacherLogin（誤PW・disabled → 拒否）/ `/api/school/me` /
  admin の teacher発行・plan設定 / 別校トークンで越境不可。
- `bun run typecheck`、admin typecheck+build。
