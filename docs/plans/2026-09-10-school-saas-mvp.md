# 学校向け有料プラン（先生ダッシュボード＋欠席受付）MVP 設計プラン

作成日: 2026-09-10

## 背景 / 要望

やすみ？のマネタイズを、私立学校向けの「公式配信SaaS」として本格化する。無料の学生/保護者向けプロダクトは
そのまま（2サイドモデル・学生無料死守）で、**学校が“公式の発信元”になれる有料プラン**を上に乗せる。
マネタイズ方針の全体像・料金プランは [monetization-plan（メモリ）] と
学校向け営業LP `landing/src/pages/for-schools.astro` を参照。

本ドキュメントは、有料プロダクト化に必要な **先生向けダッシュボード** と **課金（プラン制御）**、
プレミアムの目玉 **欠席受付（双方向）** の MVP 設計を、grilling（2026-09-10 の議論）で決めた内容で確定するもの。

> 本番反映は保留中。実装はまだ着手しない（本ドキュメントは設計の合意記録）。

---

## 決定事項（grilling 2026-09-10）

| # | 論点 | 決定 |
|---|---|---|
| A | 先生ダッシュボードの置き場所 | **別アプリで新設**（例 `school.yasumi.unischool.jp`）。バックエンド共用・学校アカウント認証・自校スコープ |
| B | 最初の課金の入り口 | **手動・請求書から**（社内adminが手でプラン付与＋有効期限）。決済（Stripe）は継ぎ目だけ用意し後回し |
| C | MVP スコープ | **欠席受付（双方向）まで含める**（＝プレミアムの目玉を最初から） |
| D | 「開封率」の扱い | **到達のみに弱める**。LINE push には既読APIが無く開封は取得不可（FCMも同様）。LPの「既読・開封」表現は本番前に「到達」へ修正する（別TODO） |
| E | 欠席PIIの扱い | 生徒名・健康理由を含むため**テナントスコープ厳守**。実装後に security-review スキルを必ず回す |
| F | 生徒↔保護者の紐付け | **MVPではクロスアカウント紐付け（linkToken）を作らない**。欠席を出すアカウントが自分の `student_profile` を1回登録→以降ワンタップ。保護者↔生徒のリンク生成/読込は Phase 3+ に分離 |
| G | 休校の正当性 | **警報連動で自動タグ＋監視**。既存 `warning_checks` でその日その学校の警報有無を判定し `absence_reports.warningActive` に記録。警報なしで「休校」選択は監視リストに浮かせる |
| H | 教員アカウント | **`teachers` テーブルを最初から**（role: owner/teacher）。MVP運用は owner 1人でも構造は複数教員前提 |
| I | アーキテクチャ | **モジュラモノリス継続**（マイクロサービス化しない）。先生ダッシュボードは別フロント・同一バックエンド＝マルチクライアントなモノリス。将来スケール時に警報/通知パイプラインを worker として切り出す余地だけ残す |

### なぜマイクロサービスにしないか
PMF前・少人数でのプロセス分割は保守性を下げる（複数デプロイ・ネットワーク境界・分散Tx・認証伝播・監視の追加コスト）。
今欲しいのは「プロセス境界」ではなく「モジュール境界」で、フォルダ/パッケージで境界を締めれば十分。
既存backendは notification provider 抽象化・repo分離で継ぎ目が綺麗。必要になってから、その継ぎ目から worker を切り出す。

---

## アーキテクチャ概要

認証主体が3種類になる（従来: 社内admin / LINEエンドユーザー の2種 → **教員アカウント**を追加）。

```
[社内 admin]         全学校を横断操作（社内オペ・プロビジョニング）
[teacher]  ← NEW    自校のみスコープ（先生ダッシュボード school.*）
[LINE user]         生徒/保護者（無料アプリ・欠席送信）
```

- 先生ダッシュボードは **新フロント（別アプリ）**、バックエンドは既存を共用。
- 全ての教員向けAPIは **テナントミドルウェア** でログインアカウントの `schoolId` を固定し「自校データのみ」を強制。
  横断参照を1本でも許すと PII 事故になるため、リポジトリ層でも `schoolId` 必須の関数のみ公開する。

---

## データモデル（新規/変更）

### 新規テーブル
```
teachers {
  id uuid pk
  schoolId uuid → schools.id     -- テナント境界
  email varchar unique
  passwordHash text
  role varchar                   -- 'owner' | 'teacher'
  name varchar
  disabled boolean default false
  createdAt timestamptz
}

student_profiles {
  id uuid pk
  schoolId uuid → schools.id
  ownerUserId uuid → users.id     -- 登録したLINEアカウント（生徒本人 or 保護者）
  studentName varchar
  grade varchar                   -- 学年
  class varchar                   -- 組
  -- 以下は Phase 3+（クロスアカウント紐付け）用に予約。MVPでは未使用
  linkToken varchar null
  linkedStudentUserId uuid null
  createdAt timestamptz
}

absence_reports {
  id uuid pk
  schoolId uuid → schools.id      -- テナント境界（全クエリで強制）
  studentProfileId uuid → student_profiles.id
  reportedByUserId uuid → users.id
  date date
  type varchar                    -- '欠席' | '遅刻' | '早退' | '休校'
  reason text
  note text null
  warningActive boolean           -- 自動: その日その学校で警報が出ていたか（warning_checks 由来）
  status varchar default 'unread' -- 'unread' | 'confirmed'
  createdAt timestamptz
}
```

### schools への追加列
```
plan varchar null                 -- 'basic' | 'standard' | 'premium'（null=無料/未契約）
planExpiresAt timestamptz null    -- 有効期限（社内adminが手動設定）
```

### 任意送信の月間通数カウンタ
- 警報連動・休校・緊急は**無制限**。任意の「お知らせ」だけ計上。
- 送信時に先生が「緊急/休校（無制限）」か「お知らせ（計上）」かを選ぶ。
- 集計は `notifications`/送信ログにカテゴリ列を持たせ、月次で count する方針（実装時に確定）。

---

## Phase 順（段階ビルド）

### Phase 0 — 基盤（テナント認証＋プラン）
- `teachers` テーブル＋マイグレーション。
- 教員認証（admin JWT に倣った HS256・`teachers` 系統）＋**テナントミドルウェア**（`schoolId` 固定）。
- `schools.plan` / `planExpiresAt` 追加。
- 社内 admin に「教員アカウント発行・プラン設定・有効期限」を追加（手動プロビジョニング）。

### Phase 1 — 先生ダッシュボード（別アプリ）
- 新フロント（`school/` ワークスペース想定・別ドメイン）。教員ログイン。
- 自校の **公式メッセージ送信**（既存 notifyUser 経路を school-account 認証＋テナントスコープで）。
- **到達状況**（送信成功/失敗）。※開封は取得不可（決定D）。
- **購読者一覧**（既存 `listSubscribersBySchool` を自校スコープで）。

### Phase 2 — 欠席受付（プレミアムの目玉）
- LIFF に **`student_profile` 登録（1回）＋「欠席を連絡する」フォーム**（生徒名・学年組・日付・種別・理由）。
- 送信時に **その日の警報有無を自動判定** → `warningActive` 記録（決定G）。
- 先生ダッシュボードに **受信箱（未読/確認済み）** ＋ **「要確認（警報なし休校）」タブ**（不正使用の監視導線）。
- **plan gate**: 欠席受付は premium のみ。plan が premium でない学校では LIFF 側の導線も出さない。

### Phase 3 — 通数・請求運用・（後で）Stripe
- 任意送信の月間通数カウンタと上限表示。
- 請求書運用の型（社内adminでプラン/期限管理）。
- Stripe（カード自動）の継ぎ目。※需要を見てから。
- 生徒↔保護者クロス紐付け（linkToken フロー）もこの段階以降で検討。

---

## スコープ外（今回入れない）

- 生徒↔保護者のクロスアカウント紐付け（linkToken 生成/読込）＝ Phase 3+。
- Stripe セルフサーブ決済・学校の自動サインアップ。
- 開封率（LINE/FCM で取得不可）。将来やるなら「確認しました」クリック計測で代替。
- マイクロサービス化・バックエンド分割。
- 教員の細かな権限分割（owner/teacher の2値のみでMVP）。

---

## 検証（Verification）

- **backend**（`bun test`, DB-gated）: `teachers` repo / テナントミドルウェア（他校データに触れないこと）/
  `absence_reports` の schoolId スコープ / `warningActive` 自動タグ / plan gate。
- **security-review スキルを必ず実行**（PII・テナント越境の観点）。決定E。
- 先生ダッシュボード: 別ドメインからの認証・自校スコープのE2E。
- LIFF: `student_profile` 登録→欠席送信→ダッシュボード受信箱に自校のみ表示。

---

## 未確定 / 実装時に詰める

- 任意送信のカテゴリ列の持ち方（`notifications` 拡張 or 新テーブル）と月次集計の正確な実装。
- 教員認証のパスワードリセット/初回発行フロー（MVPは社内adminが発行・初期PW通知でも可）。
- 先生ダッシュボードのワークスペース構成（`school/` を monorepo に追加、ドメイン・deploy.yml 追記）。
- LP の「開封」表現を「到達」へ修正（本番前 TODO・決定D）。

## 関連
- マネタイズ全体: memory `monetization-plan`
- 営業LP: `landing/src/pages/for-schools.astro`
- 校内密度パネル（営業指標・実装済み）: commit a7aaf11
- ネイティブアプリ/FCM（無料プッシュの継ぎ目）: `docs/plans/2026-09-09-native-app-push.md`
