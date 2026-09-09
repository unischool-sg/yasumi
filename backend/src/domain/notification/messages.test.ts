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
});
