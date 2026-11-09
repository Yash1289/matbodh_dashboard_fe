import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost, getRun, planCard, startRun } from "./client";
import type { StateContext } from "./types";

const ctx: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["o1"], compare_round: null,
  anchor_round: null, version_mode: "extrapolated", geo_scope: "state",
};

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("422 becomes ApiError with errors", async () => {
    const errors = ["at least one round must be selected"];
    vi.stubGlobal("fetch", reply(422, { valid: false, errors }));
    const err = await planCard("c", ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).errors).toEqual(errors);
    expect((err as ApiError).message).toBe(errors[0]);
  });

  it("404 detail becomes message", async () => {
    vi.stubGlobal("fetch", reply(404, { detail: "unknown run 'x'" }));
    const err = (await getRun("x").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(404);
    expect(err.errors).toEqual(["unknown run 'x'"]);
  });

  it("non-JSON error falls back to HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    const err = (await apiGet("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe("HTTP 500");
    expect(err.errors).toEqual([]);
  });

  it("network failure becomes ApiError status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    const err = (await apiGet("/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe("Cannot reach the dashboard API");
  });

  it("sends principal header", async () => {
    const f = reply(200, { run_id: "r1" });
    vi.stubGlobal("fetch", f);
    expect(await startRun("c", ctx)).toBe("r1");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cards/run");
    expect(new Headers(init.headers).get("X-Dashboard-User")).toBe("anonymous");
    expect(JSON.parse(init.body as string)).toEqual({ card_id: "c", context: ctx });
  });

  it("apiPost sends JSON content type", async () => {
    const f = reply(200, {});
    vi.stubGlobal("fetch", f);
    await apiPost("/y", { a: 1 });
    const [, init] = f.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });
});
