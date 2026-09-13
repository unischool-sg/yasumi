import type { Warning } from "@yasumi/shared";
import { describe, expect, it } from "bun:test";
import { buildNotificationText } from "./messages.ts";
import { shouldNotify } from "./provider.ts";

const warnings: Warning[] = [
  { areaCode: "2834100", areaName: "三田市", warningType: "暴風警報", status: "active", issuedAt: new Date() },
];

describe("shouldNotify", () => {
  it("NORMAL は通知しない", () => {
    expect(shouldNotify("NORMAL")).toBe(false);
  });
  it("AM_OFF / FULL_OFF / UNKNOWN は通知する", () => {
    expect(shouldNotify("AM_OFF")).toBe(true);
    expect(shouldNotify("FULL_OFF")).toBe(true);
    expect(shouldNotify("UNKNOWN")).toBe(true);
  });
});

describe("buildNotificationText", () => {
  it("AM_OFF: 午前休・学校名・理由・免責を含む", () => {
    const text = buildNotificationText({ result: "AM_OFF", schoolName: "三田学園", checkTime: "08:00", matchedWarnings: warnings });
    expect(text).toContain("三田学園");
    expect(text).toContain("午前休");
    expect(text).toContain("三田市 暴風警報");
    expect(text).toContain("08:00");
    expect(text).toContain("学校公式");
  });

  it("FULL_OFF: 休校の文言", () => {
    const text = buildNotificationText({ result: "FULL_OFF", schoolName: "三田学園", checkTime: "10:00", matchedWarnings: warnings });
    expect(text).toContain("本日は休校");
    expect(text).toContain("10:00");
  });

  it("UNKNOWN: 判定できませんでした", () => {
    const text = buildNotificationText({ result: "UNKNOWN", schoolName: "三田学園", checkTime: "08:00", matchedWarnings: [] });
    expect(text).toContain("判定できませんでした");
    expect(text).toContain("学校公式");
  });

  it("理由は重複排除される", () => {
    const dup: Warning[] = [warnings[0]!, { ...warnings[0]! }];
    const text = buildNotificationText({ result: "AM_OFF", schoolName: "X", checkTime: "08:00", matchedWarnings: dup });
    expect(text.match(/三田市 暴風警報/g)?.length).toBe(1);
  });

  it("解除にもとづく PM_START: 警報が発表中とは書かず『解除』の文言", () => {
    const text = buildNotificationText({ result: "PM_START", schoolName: "三田学園", checkTime: "10:00", matchedWarnings: [] });
    expect(text).toContain("午後から登校");
    expect(text).toContain("解除");
    expect(text).not.toContain("発表されています");
  });

  it("inviteUrl 指定時: 招待行とURLを免責より前に含む", () => {
    const url = "https://liff.line.me/2011-x?school=abc";
    const text = buildNotificationText({ result: "FULL_OFF", schoolName: "三田学園", checkTime: "10:00", matchedWarnings: warnings, inviteUrl: url });
    expect(text).toContain("友達にも教える");
    expect(text).toContain(url);
    expect(text.indexOf(url)).toBeLessThan(text.indexOf("学校公式"));
  });

  it("inviteUrl 未指定時: 招待行は付かない", () => {
    const text = buildNotificationText({ result: "FULL_OFF", schoolName: "三田学園", checkTime: "10:00", matchedWarnings: warnings });
    expect(text).not.toContain("友達にも教える");
  });

  it("UNKNOWN には inviteUrl があっても招待行を付けない", () => {
    const text = buildNotificationText({ result: "UNKNOWN", schoolName: "三田学園", checkTime: "08:00", matchedWarnings: [], inviteUrl: "https://x/?school=abc" });
    expect(text).not.toContain("友達にも教える");
  });
});
