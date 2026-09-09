import { describe, expect, it } from "bun:test";
import { app } from "./app.ts";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
