import type {
  BenchmarkReference, CardConfigJson, CardMode, CardRef, DistinctValues, OptionItem, PlanResponse, RunStatus, StateContext, ValidateResponse,
} from "./types";

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

// `reference` only exists for benchmark cards; it is left out of the body when absent.
const cardBody = (ref: CardRef, ctx: StateContext, reference?: BenchmarkReference | null) =>
  ({ ...ref, context: ctx, ...(reference ? { reference } : {}) });

export const planCard = (ref: CardRef, ctx: StateContext, reference?: BenchmarkReference | null): Promise<PlanResponse> =>
  apiPost<PlanResponse>("/cards/plan", cardBody(ref, ctx, reference));

export const startRun = async (
  ref: CardRef, ctx: StateContext, reference?: BenchmarkReference | null,
): Promise<string> =>
  (await apiPost<{ run_id: string }>("/cards/run", cardBody(ref, ctx, reference))).run_id;

/** A draft card checked against the card rules and the engine plan; nothing is run. */
export const validateCard = (card: CardConfigJson, ctx: StateContext): Promise<ValidateResponse> =>
  apiPost<ValidateResponse>("/cards/validate", { card, context: ctx });

/** Starts a run that lists the values of one respondent field; read it with `getRun`. */
export const startValues = async (
  field: string, scenario: string | null, ctx: StateContext, pipeRounds: number | null,
): Promise<string> =>
  (await apiPost<{ run_id: string }>("/configure/values", {
    field, scenario, context: ctx, pipe_rounds: pipeRounds,
  })).run_id;

/** The values of one respondent field from a lookup (reporting mapping, else distinct answers), for the rounds the card's mode reads. */
export const fetchDistinctValues = (
  field: string, mode: CardMode, ctx: StateContext, pipeRounds: number | null,
): Promise<DistinctValues> =>
  apiPost<DistinctValues>("/configure/values/distinct", { field, mode, context: ctx, pipe_rounds: pipeRounds });

export const fetchOptions = (
  source: string, params: Record<string, string>, draft: CardConfigJson, ctx: StateContext,
): Promise<OptionItem[]> =>
  apiPost<OptionItem[]>("/configure/options", { source, params, card: draft, context: ctx });

export const getRun = (runId: string): Promise<RunStatus> =>
  apiGet<RunStatus>(`/runs/${encodeURIComponent(runId)}`);
