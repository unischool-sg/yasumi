import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { sign } from "hono/jwt";
import { z } from "zod";
import type { Db } from "../../infrastructure/db/client.ts";
import type { NotificationProvider } from "../../domain/notification/provider.ts";
import { notifyUser } from "../../domain/notification/dispatch.ts";
import { prepareLogo } from "../../domain/logo.ts";
import { announcementMonthlyLimit, hasFeature, jstMonthStart, teacherSeatLimit } from "../../domain/plan.ts";
import * as teachersRepo from "../../infrastructure/db/repositories/teachers.ts";
import type { Storage } from "../../infrastructure/storage/s3.ts";
import * as absenceReportsRepo from "../../infrastructure/db/repositories/absence-reports.ts";
import * as closureDraftsRepo from "../../infrastructure/db/repositories/closure-drafts.ts";
import * as msgRepo from "../../infrastructure/db/repositories/school-messages.ts";
import * as schoolsRepo from "../../infrastructure/db/repositories/schools.ts";
import * as subsRepo from "../../infrastructure/db/repositories/subscriptions.ts";
import * as templatesRepo from "../../infrastructure/db/repositories/message-templates.ts";
import { rateLimit } from "../middleware/rate-limit.ts";
import { type SchoolEnv, teacherAuthMiddleware, teacherLogin } from "./auth.ts";

export interface SchoolAppDeps {
  db: Db;
  schoolJwtSecret: string;
  now?: () => Date;
  /** 公式メッセージ送信用（LINE / FCM 送り分け）。 */
  notificationProvider?: NotificationProvider;
  pushProvider?: NotificationProvider;
  /** 確認リンクの生成に使う API 公開URL（例 https://yasumi-api.unischool.jp）。未設定なら確認リンクを付けない。 */
  apiBaseUrl?: string;
  /** ロゴ等のオブジェクトストレージ（RustFS/S3）。未設定ならロゴ機能は無効。 */
  storage?: Storage;
}

/**
 * 先生ダッシュボード API（`/api/school` にマウント）。教員アカウント認証・自校スコープ。
 * Phase 0 はログインと /me のみ。送信/購読者/欠席などの業務EPは M12/M13 で追加。
 */
export function createSchoolApp(deps: SchoolAppDeps) {
  const { db } = deps;
  const app = new Hono<SchoolEnv>();

  // --- 公開: ログイン ---
  app.use("/auth/login", rateLimit({ max: 20, windowMs: 60_000 }));
  app.post(
    "/auth/login",
    zValidator("json", z.object({ email: z.string().email(), password: z.string().min(1) })),
    async (c) => {
      const { email, password } = c.req.valid("json");
      const result = await teacherLogin(db, deps.schoolJwtSecret, email, password);
      if (!result) return c.json({ error: "invalid credentials" }, 401);
      return c.json(result);
    },
  );

  // --- 以降は認証必須（テナント＝トークンの schoolId 固定・毎回 DB 再検証）---
  app.use("*", teacherAuthMiddleware(deps.schoolJwtSecret, db));

  app.get("/me", async (c) => {
    const teacher = c.get("teacher");
    const school = await schoolsRepo.findSchoolById(db, teacher.schoolId);
    return c.json({
      teacher,
      school: school
        ? {
            id: school.id,
            name: school.name,
            prefecture: school.prefecture,
            plan: school.plan,
            planExpiresAt: school.planExpiresAt,
          }
        : null,
    });
  });

  // 自校の購読者一覧（テナントスコープ）
  app.get("/subscribers", async (c) =>
    c.json(await subsRepo.listSubscribersBySchool(db, c.get("teacher").schoolId)),
  );

  // 公式メッセージの一斉送信（自校購読者へ）。category: emergency(無制限) / announcement(通数計上)
  app.post(
    "/broadcast",
    zValidator("json", z.object({
      text: z.string().min(1).max(1000),
      category: z.enum(["emergency", "announcement"]),
      kind: z.enum(["closure", "event", "safety", "health", "general"]).optional(),
      requireConfirmation: z.boolean().optional(),
      target: z.object({ grade: z.string().max(20).optional(), className: z.string().max(20).optional() }).optional(),
    })),
    async (c) => {
      const { schoolId, id: teacherId } = c.get("teacher");
      const { text, category, kind, requireConfirmation, target } = c.req.valid("json");
      const now = deps.now?.() ?? new Date();
      const school = await schoolsRepo.findSchoolById(db, schoolId);
      // お知らせ（任意送信）は月間通数の上限を超えたら 403。緊急/休校は無制限。
      if (category === "announcement") {
        const limit = announcementMonthlyLimit(school ?? { plan: null, planExpiresAt: null }, now);
        if (limit !== null) {
          const used = await msgRepo.countAnnouncementsSince(db, schoolId, jstMonthStart(now));
          if (used >= limit) return c.json({ error: "quota exceeded", used, limit }, 403);
        }
      }
      // kind 指定・セグメント配信は standard+
      const usesKind = kind && kind !== "general";
      const usesSegment = !!(target?.grade || target?.className);
      if ((usesKind || usesSegment) && (!school || !hasFeature(school, usesSegment ? "segment" : "messageKind", now))) {
        return c.json({ error: "分類・セグメント配信はスタンダード以上のプランで利用できます" }, 402);
      }
      // 宛先解決（セグメント指定時は学年/組で絞り込み。profile 未登録者は対象外）
      const subs = usesSegment
        ? await subsRepo.listSubscribersBySchoolFiltered(db, schoolId, { ...(target?.grade ? { grade: target.grade } : {}), ...(target?.className ? { className: target.className } : {}) })
        : await subsRepo.listSubscribersBySchool(db, schoolId);
      const total = subs.length;
      const withConfirm = !!requireConfirmation && !!deps.apiBaseUrl;
      // 確認リンクは受信者ごとに token を埋めるため、先に message 行を作って id を確定する。
      const row = await msgRepo.createMessage(db, {
        schoolId, teacherId, category, ...(kind ? { kind } : {}), text, total, sent: 0, failed: total,
        requireConfirmation: withConfirm,
      });
      const notifyDeps = {
        db,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
      };
      let sent = 0;
      for (const s of subs) {
        let action: { label: string; url: string } | undefined;
        if (withConfirm) {
          const token = await sign({ m: row.id, u: s.userId }, deps.schoolJwtSecret, "HS256");
          action = { label: "確認する", url: `${deps.apiBaseUrl}/c/${token}` };
        }
        if (await notifyUser(notifyDeps, s.userId, text, action)) sent++;
      }
      await msgRepo.updateCounts(db, row.id, sent, total - sent);
      return c.json({ id: row.id, total, sent, failed: total - sent });
    },
  );

  // 送信履歴（到達状況＋確認数）
  app.get("/messages", async (c) =>
    c.json(await msgRepo.listBySchool(db, c.get("teacher").schoolId)),
  );

  // --- CSV エクスポート（premium / M21）---
  const KIND_LABEL: Record<string, string> = { closure: "休校", event: "行事", safety: "防犯", health: "保健", general: "一般" };
  const csvResponse = (c: Context<SchoolEnv>, filename: string, rows: (string | number)[][]) => {
    const esc = (v: string | number) => {
      let s = String(v ?? "");
      // 数式インジェクション対策: 先頭が = + - @ タブ CR のセルは ' で無害化。
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n"); // BOM で Excel 文字化け回避
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    });
  };
  const requirePremium = async (schoolId: string): Promise<boolean> => {
    const s = await schoolsRepo.findSchoolById(db, schoolId);
    return !!s && hasFeature(s, "csvExport", deps.now?.() ?? new Date());
  };

  app.get("/messages.csv", async (c) => {
    const schoolId = c.get("teacher").schoolId;
    if (!(await requirePremium(schoolId))) return c.json({ error: "CSV出力はプレミアムプランで利用できます" }, 402);
    const msgs = await msgRepo.listBySchool(db, schoolId, 1000);
    const rows: (string | number)[][] = [["日時", "分類", "カテゴリ", "本文", "到達", "総数", "失敗", "確認"]];
    for (const m of msgs) {
      rows.push([new Date(m.createdAt).toISOString(), KIND_LABEL[m.kind] ?? m.kind, m.category, m.text, m.sent, m.total, m.failed, m.confirmedCount]);
    }
    return csvResponse(c, "messages.csv", rows);
  });

  app.get("/absences.csv", async (c) => {
    const schoolId = c.get("teacher").schoolId;
    if (!(await requirePremium(schoolId))) return c.json({ error: "CSV出力はプレミアムプランで利用できます" }, 402);
    const list = await absenceReportsRepo.listBySchool(db, schoolId);
    const rows: (string | number)[][] = [["日付", "生徒", "学年", "組", "種別", "理由", "警報", "状態"]];
    for (const a of list) {
      rows.push([a.date, a.studentName, a.grade ?? "", a.className ?? "", a.type, a.reason ?? "", a.warningActive ? "あり" : "なし", a.status === "confirmed" ? "確認済み" : "未読"]);
    }
    return csvResponse(c, "absences.csv", rows);
  });

  // --- テンプレート（定型文・自校スコープ）---
  app.get("/templates", async (c) => c.json(await templatesRepo.listBySchool(db, c.get("teacher").schoolId)));
  app.post(
    "/templates",
    zValidator("json", z.object({
      title: z.string().min(1).max(100),
      category: z.enum(["emergency", "announcement"]),
      kind: z.enum(["closure", "event", "safety", "health", "general"]).optional(),
      body: z.string().min(1).max(1000),
    })),
    async (c) => {
      const b = c.req.valid("json");
      const row = await templatesRepo.createTemplate(db, { schoolId: c.get("teacher").schoolId, ...b });
      return c.json(row, 201);
    },
  );
  app.delete("/templates/:id", async (c) => {
    await templatesRepo.deleteInSchool(db, c.get("teacher").schoolId, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- 警報連動の休校ドラフト（自動生成→ワンタップ送信 / M16）---
  app.get("/drafts", async (c) => c.json(await closureDraftsRepo.listPendingBySchool(db, c.get("teacher").schoolId)));
  app.post(
    "/drafts/:id/send",
    zValidator("json", z.object({ text: z.string().min(1).max(1000).optional() })),
    async (c) => {
      const { schoolId, id: teacherId } = c.get("teacher");
      const draft = await closureDraftsRepo.findInSchool(db, schoolId, c.req.param("id"));
      if (!draft || draft.status !== "pending") return c.json({ error: "not found" }, 404);
      const text = c.req.valid("json").text ?? draft.text;
      const subs = await subsRepo.listSubscribersBySchool(db, schoolId);
      const notifyDeps = {
        db,
        ...(deps.notificationProvider ? { notificationProvider: deps.notificationProvider } : {}),
        ...(deps.pushProvider ? { pushProvider: deps.pushProvider } : {}),
      };
      let sent = 0;
      for (const s of subs) if (await notifyUser(notifyDeps, s.userId, text)) sent++;
      await msgRepo.createMessage(db, {
        schoolId, teacherId, category: "emergency", text, total: subs.length, sent, failed: subs.length - sent,
      });
      await closureDraftsRepo.setStatusInSchool(db, schoolId, draft.id, "sent");
      return c.json({ total: subs.length, sent, failed: subs.length - sent });
    },
  );
  app.post("/drafts/:id/dismiss", async (c) => {
    const updated = await closureDraftsRepo.setStatusInSchool(db, c.get("teacher").schoolId, c.req.param("id"), "dismissed");
    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json(updated);
  });

  // 今月の任意送信（お知らせ）の残数
  app.get("/quota", async (c) => {
    const schoolId = c.get("teacher").schoolId;
    const school = await schoolsRepo.findSchoolById(db, schoolId);
    const now = deps.now?.() ?? new Date();
    const limit = announcementMonthlyLimit(school ?? { plan: null, planExpiresAt: null }, now);
    const used = await msgRepo.countAnnouncementsSince(db, schoolId, jstMonthStart(now));
    return c.json({ plan: school?.plan ?? null, announcement: { used, limit } });
  });

  // --- 欠席受付の受信箱（M13・自校スコープ）---
  app.get(
    "/absences",
    zValidator("query", z.object({ status: z.enum(["unread", "confirmed"]).optional() })),
    async (c) => {
      const { status } = c.req.valid("query");
      const rows = await absenceReportsRepo.listBySchool(db, c.get("teacher").schoolId, {
        ...(status ? { status } : {}),
      });
      return c.json(rows);
    },
  );

  app.patch(
    "/absences/:id",
    zValidator("json", z.object({ status: z.enum(["unread", "confirmed"]) })),
    async (c) => {
      // schoolId スコープで更新（他校の欠席は 404）
      const updated = await absenceReportsRepo.setStatusInSchool(
        db,
        c.get("teacher").schoolId,
        c.req.param("id"),
        c.req.valid("json").status,
      );
      if (!updated) return c.json({ error: "not found" }, 404);
      return c.json(updated);
    },
  );

  // --- 教員アカウントの自己管理（owner・standard+ / M18）---
  const ownerManage = async (c: { get: (k: "teacher") => SchoolEnv["Variables"]["teacher"] }) => {
    const t = c.get("teacher");
    if (t.role !== "owner") return { err: 403 as const };
    const school = await schoolsRepo.findSchoolById(db, t.schoolId);
    if (!school) return { err: 404 as const };
    if (!hasFeature(school, "ownerManageTeachers", deps.now?.() ?? new Date())) return { err: 402 as const };
    return { school, schoolId: t.schoolId };
  };

  app.get("/teachers", async (c) => {
    const t = c.get("teacher");
    if (t.role !== "owner") return c.json({ error: "forbidden" }, 403);
    return c.json(await teachersRepo.listTeachersBySchool(db, t.schoolId));
  });
  app.post(
    "/teachers",
    zValidator("json", z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      role: z.enum(["owner", "teacher"]).optional(),
    })),
    async (c) => {
      const g = await ownerManage(c);
      if ("err" in g) return c.json({ error: g.err === 402 ? "スタンダード以上のプランで教員を追加できます" : g.err === 404 ? "not found" : "forbidden" }, g.err);
      const b = c.req.valid("json");
      const limit = teacherSeatLimit(g.school, deps.now?.() ?? new Date());
      if (limit !== null && (await teachersRepo.countBySchool(db, g.schoolId)) >= limit) {
        return c.json({ error: `教員アカウント上限（${limit}）に達しています` }, 409);
      }
      if (await teachersRepo.findTeacherByEmail(db, b.email)) return c.json({ error: "email taken" }, 409);
      const passwordHash = await Bun.password.hash(b.password);
      const row = await teachersRepo.createTeacher(db, { schoolId: g.schoolId, email: b.email, passwordHash, name: b.name, ...(b.role ? { role: b.role } : {}) });
      const { passwordHash: _o, ...safe } = row;
      return c.json(safe, 201);
    },
  );
  app.patch(
    "/teachers/:id",
    zValidator("json", z.object({
      role: z.enum(["owner", "teacher"]).optional(),
      disabled: z.boolean().optional(),
      password: z.string().min(8).optional(),
      name: z.string().min(1).optional(),
    })),
    async (c) => {
      const g = await ownerManage(c);
      if ("err" in g) return c.json({ error: "forbidden" }, g.err);
      // 自校の教員のみ更新可
      const target = await teachersRepo.findTeacherInSchool(db, g.schoolId, c.req.param("id"));
      if (!target) return c.json({ error: "not found" }, 404);
      const b = c.req.valid("json");
      const patch: { role?: "owner" | "teacher"; disabled?: boolean; passwordHash?: string; name?: string } = {};
      if (b.role !== undefined) patch.role = b.role;
      if (b.disabled !== undefined) patch.disabled = b.disabled;
      if (b.name !== undefined) patch.name = b.name;
      if (b.password !== undefined) patch.passwordHash = await Bun.password.hash(b.password);
      const updated = await teachersRepo.updateTeacher(db, target.id, patch);
      const { passwordHash: _o, ...safe } = updated!;
      return c.json(safe);
    },
  );
  app.delete("/teachers/:id", async (c) => {
    const g = await ownerManage(c);
    if ("err" in g) return c.json({ error: "forbidden" }, g.err);
    await teachersRepo.deleteTeacherInSchool(db, g.schoolId, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- 学校ロゴ（owner・standard+ で自校のロゴを差し替え / M17）---
  app.post(
    "/logo",
    zValidator("json", z.object({ contentType: z.string().min(1), dataBase64: z.string().min(1) })),
    async (c) => {
      const teacher = c.get("teacher");
      if (teacher.role !== "owner") return c.json({ error: "forbidden" }, 403);
      if (!deps.storage) return c.json({ error: "storage not configured" }, 503);
      const school = await schoolsRepo.findSchoolById(db, teacher.schoolId);
      if (!school) return c.json({ error: "not found" }, 404);
      if (!hasFeature(school, "logo", deps.now?.() ?? new Date())) {
        return c.json({ error: "ロゴ設定はスタンダード以上のプランで利用できます" }, 403);
      }
      const b = c.req.valid("json");
      const prepared = prepareLogo(teacher.schoolId, b.contentType, b.dataBase64);
      if (!prepared.ok) return c.json({ error: prepared.error }, 400);
      await deps.storage.put(prepared.key, prepared.bytes, prepared.contentType);
      await schoolsRepo.updateSchool(db, teacher.schoolId, { logoKey: prepared.key });
      return c.json({ logoKey: prepared.key });
    },
  );
  app.delete("/logo", async (c) => {
    const teacher = c.get("teacher");
    if (teacher.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const school = await schoolsRepo.findSchoolById(db, teacher.schoolId);
    if (school?.logoKey && deps.storage) await deps.storage.delete(school.logoKey).catch(() => {});
    if (school) await schoolsRepo.updateSchool(db, teacher.schoolId, { logoKey: null });
    return c.body(null, 204);
  });

  return app;
}
