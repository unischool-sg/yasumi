import {
  boolean,
  date,
  index,
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
  // Google Ads コンバージョン計測用（first-touch の gclid）。
  gclid: varchar("gclid", { length: 200 }),
  gclidAt: timestamp("gclid_at", { withTimezone: true }),
  gclidConvertedAt: timestamp("gclid_converted_at", { withTimezone: true }),
  // 流入時のクエリ一式を first-touch で保存（gclid/utm_*/school/ref 等・分析用）。
  // 友だち追加リダイレクトで URL パラメータが失われても復元できるよう、着地直後に保存する。
  landingQuery: jsonb("landing_query"),
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

// 管理画面のメッセージ定型文（全体スコープ・学校向けとは別 / admin ユーザー送信用）。
export const adminMessageTemplates = pgTable("admin_message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 100 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ユーザーフラグ（タグ）の定義（選択肢の元）。
export const flagDefs = pgTable("flag_defs", {
  name: varchar("name", { length: 50 }).primaryKey(),
  color: varchar("color", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ユーザーへのフラグ付与（多対多）。
export const userFlags = pgTable(
  "user_flags",
  {
    userId: uuid("user_id").notNull(),
    name: varchar("name", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.name] })],
);

// フロー（一括施策）テンプレート: 対象条件（query）＋ステップ（steps）を名前付きで保存。
export const flowTemplates = pgTable("flow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  // 全ユーザー対象なら allUsers=true（query は無視）。
  allUsers: boolean("all_users").notNull().default(false),
  query: jsonb("query").notNull(), // FlowAudienceQuery
  steps: jsonb("steps").notNull(), // FlowStep[]
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// フローの定期実行スケジュール（既存 cron の 30分刻みに乗せる）。
export const flowSchedules = pgTable("flow_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull(),
  time: varchar("time", { length: 5 }).notNull(), // JST "HH:MM"（:00/:30 に整列）
  daysOfWeek: jsonb("days_of_week").notNull(), // number[] 0=日..6=土、空配列は毎日
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastRunDate: varchar("last_run_date", { length: 10 }), // JST "YYYY-MM-DD"（同日二重実行防止）
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// フローのイベント連動トリガー（イベント発火時にテンプレを自動実行）。
export const flowEventTriggers = pgTable("flow_event_triggers", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull(),
  eventType: varchar("event_type", { length: 40 }).notNull(), // FlowEventType
  audienceMode: varchar("audience_mode", { length: 40 }).notNull(), // FlowTriggerAudienceMode
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// フロー実行ログ（手動/定期/イベントを記録）。1ヶ月で S3 退避のうえ削除（retention）。
export const flowRunLogs = pgTable(
  "flow_run_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // テンプレは削除されうるため FK/NOT NULL にしない。名前は実行時点のスナップショットを保持。
    templateId: uuid("template_id"),
    templateName: varchar("template_name", { length: 100 }).notNull(),
    trigger: varchar("trigger", { length: 20 }).notNull(), // 'manual' | 'schedule' | 'event'
    scheduleId: uuid("schedule_id"),
    eventType: varchar("event_type", { length: 40 }), // trigger='event' のときのイベント種別

    audienceCount: integer("audience_count").notNull().default(0),
    results: jsonb("results").notNull(), // FlowRunLogStep[]
    status: varchar("status", { length: 20 }).notNull(), // 'success' | 'error'
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("flow_run_logs_created_at_idx").on(t.createdAt)],
);

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
  // 成立条件（RuleCondition）。null は従来互換で WARNING_ACTIVE 扱い（詳細エディタで拡張）。
  condition: jsonb("condition"),
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
    // 送信チャネル（"fcm" | "line"）。詳細モーダルで経路を示す。送信試行時に確定。
    channel: varchar("channel", { length: 10 }),
    // 実際に送ろうとした本文（診断用）。作成時に保存。
    messageText: text("message_text"),
    // 送信失敗時のエラーログ（未友だち/APIエラー等）。成功時は null。
    error: text("error"),
  },
  (t) => [unique("notifications_unique").on(t.userId, t.schoolId, t.ruleId, t.targetDate)],
);
