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
