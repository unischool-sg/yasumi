import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// PRD §38〜§47 の DDL を Drizzle で表現する。詳細は backend/DB.md。

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 管理画面のアカウント（LINE ユーザーとは別系統・id/password 認証 / admin）。
export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("admin"), // 'superadmin' | 'admin'
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lineAccounts = pgTable("line_accounts", {
  userId: uuid("user_id").primaryKey(),
  lineUserId: varchar("line_user_id", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ネイティブアプリ/PWA の FCM(APNs 含む) デバイストークン（1ユーザー多デバイス）。
// 無料プッシュ通知の送信先。line_accounts と同じく users.id にひも付く。
export const deviceTokens = pgTable("device_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  platform: varchar("platform", { length: 20 }).notNull(), // 'ios' | 'android' | 'web'
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  prefecture: varchar("prefecture", { length: 50 }).notNull(),
  city: varchar("city", { length: 100 }),
  websiteUrl: text("website_url"),
  rulesUrl: text("rules_url"),
  // 全校生徒数（浸透率＝購読者数/生徒数 の分母。任意入力・営業指標用）。
  studentCount: integer("student_count"),
  // 有料プラン（学校向けSaaS）。null=無料/未契約。手動プロビジョニング（社内admin）で設定。
  plan: varchar("plan", { length: 20 }), // 'basic' | 'standard' | 'premium'
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  // ロゴ画像の S3(RustFS) オブジェクトキー（例 logos/<schoolId>.png）。配信は /public/school-logo/:id。
  logoKey: varchar("logo_key", { length: 255 }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 学校の職員アカウント（先生ダッシュボード認証。テナント＝schoolId 境界）。
// 社内 admin / LINE エンドユーザーとは別系統。1教員=1レコード、role で権限。
export const teachers = pgTable("teachers", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("teacher"), // 'owner' | 'teacher'
  name: varchar("name", { length: 100 }).notNull(),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 先生ダッシュボードからの公式一斉送信ログ（到達状況の可視化＋任意送信の通数集計元）。
export const schoolMessages = pgTable("school_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").notNull(),
  teacherId: uuid("teacher_id").notNull(),
  category: varchar("category", { length: 20 }).notNull(), // 'emergency'(無制限) | 'announcement'(計上)
  // メッセージ分類（休校/行事/防犯/保健/一般。表示用・課金カテゴリとは独立 / M20）。
  kind: varchar("kind", { length: 20 }).notNull().default("general"),
  text: text("text").notNull(),
  total: integer("total").notNull(),
  sent: integer("sent").notNull(),
  failed: integer("failed").notNull(),
  // 「確認しました」リンクを付けたか（確認率計測 / M15）。
  requireConfirmation: boolean("require_confirmation").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 公式メッセージの定型文テンプレート（自校スコープ / M15）。
export const messageTemplates = pgTable("message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").notNull(),
  title: varchar("title", { length: 100 }).notNull(),
  category: varchar("category", { length: 20 }).notNull(), // 'emergency' | 'announcement'
  kind: varchar("kind", { length: 20 }).notNull().default("general"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// メッセージの「確認しました」記録（リンククリック＝確認。開封の代替 / M15）。
export const messageConfirmations = pgTable(
  "message_confirmations",
  {
    messageId: uuid("message_id").notNull(),
    userId: uuid("user_id").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

// 生徒プロフィール（欠席連絡の主体。保護者/生徒が自校ぶんを登録。テナント＝schoolId）。
// linkToken/linkedStudentUserId は Phase3+ の保護者↔生徒クロス紐付け用に予約（MVP未使用）。
export const studentProfiles = pgTable("student_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").notNull(),
  ownerUserId: uuid("owner_user_id").notNull(),
  studentName: varchar("student_name", { length: 100 }).notNull(),
  grade: varchar("grade", { length: 20 }),
  className: varchar("class_name", { length: 20 }),
  linkToken: varchar("link_token", { length: 64 }),
  linkedStudentUserId: uuid("linked_student_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 欠席・遅刻・早退・休校の連絡（PII: 生徒名・理由）。テナント＝schoolId で厳格スコープ。
export const absenceReports = pgTable("absence_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").notNull(),
  studentProfileId: uuid("student_profile_id").notNull(),
  reportedByUserId: uuid("reported_by_user_id").notNull(),
  date: date("date").notNull(),
  type: varchar("type", { length: 20 }).notNull(), // '欠席' | '遅刻' | '早退' | '休校'
  reason: text("reason"),
  note: text("note"),
  // その日その学校で警報が出ていたか（自動タグ。休校の正当性チェック用）。
  warningActive: boolean("warning_active").notNull().default(false),
  status: varchar("status", { length: 20 }).notNull().default("unread"), // 'unread' | 'confirmed'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 警報連動の休校連絡ドラフト（判定パイプラインが自動生成→先生がワンタップ送信 / M16）。
export const closureDrafts = pgTable(
  "closure_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    targetDate: date("target_date").notNull(),
    result: varchar("result", { length: 50 }).notNull(),
    text: text("text").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // 'pending' | 'sent' | 'dismissed'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("closure_drafts_unique").on(t.schoolId, t.targetDate)],
);

export const areas = pgTable("areas", {
  code: varchar("code", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  prefecture: varchar("prefecture", { length: 50 }).notNull(),
});

export const schoolAreas = pgTable(
  "school_areas",
  {
    schoolId: uuid("school_id").notNull(),
    areaCode: varchar("area_code", { length: 32 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.schoolId, t.areaCode] })],
);

export const schoolWarningTypes = pgTable(
  "school_warning_types",
  {
    schoolId: uuid("school_id").notNull(),
    warningType: varchar("warning_type", { length: 100 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.schoolId, t.warningType] })],
);

export const schoolRules = pgTable("school_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").notNull(),
  checkTime: time("check_time").notNull(),
  result: varchar("result", { length: 50 }).notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: uuid("user_id").notNull(),
    schoolId: uuid("school_id").notNull(),
    notificationEnabled: boolean("notification_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.schoolId] })],
);

export const warningChecks = pgTable(
  "warning_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    ruleId: uuid("rule_id").notNull(),
    targetDate: date("target_date").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    warningActive: boolean("warning_active").notNull(),
    result: varchar("result", { length: 50 }).notNull(),
    rawData: jsonb("raw_data"),
  },
  (t) => [unique("warning_checks_unique").on(t.schoolId, t.ruleId, t.targetDate)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    schoolId: uuid("school_id").notNull(),
    ruleId: uuid("rule_id").notNull(),
    targetDate: date("target_date").notNull(),
    status: varchar("status", { length: 50 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [unique("notifications_unique").on(t.userId, t.schoolId, t.ruleId, t.targetDate)],
);
