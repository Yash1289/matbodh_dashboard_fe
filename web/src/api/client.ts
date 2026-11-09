import type { PlanResponse, RunStatus, StateContext } from "./types";

const BASE = "/api";
const HEADERS = { "X-Dashboard-User": "anonymous" };

export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];
  constructor(status: number, errors: string[], message?: string) {
    super(message ?? errors[0] ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

function errorsFrom(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const { errors, detail } = body as { errors?: unknown; detail?: unknown };
  if (Array.isArray(errors)) return errors.map(String);
  return typeof detail === "string" ? [detail] : [];
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, [], "Cannot reach the dashboard API");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorsFrom(body));
  return body as T;
}

export const apiGet = <T>(path: string): Promise<T> =>
  request<T>(path, { headers: HEADERS });

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const planCard = (cardId: string, ctx: StateContext): Promise<PlanResponse> =>
  apiPost<PlanResponse>("/cards/plan", { card_id: cardId, context: ctx });

export const startRun = async (cardId: string, ctx: StateContext): Promise<string> =>
  (await apiPost<{ run_id: string }>("/cards/run", { card_id: cardId, context: ctx })).run_id;

export const getRun = (runId: string): Promise<RunStatus> =>
  apiGet<RunStatus>(`/runs/${encodeURIComponent(runId)}`);
