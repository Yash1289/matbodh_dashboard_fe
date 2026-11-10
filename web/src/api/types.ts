export type Level = "ac" | "pc" | "zone" | "state";
export type Unit = "pct" | "pp" | "seats";
export type CellPart = "value" | "delta" | "trend" | "base" | "secondary" | "flags";
export type Density = "compact" | "standard" | "detailed";

export interface StateContext {
  state: string;
  level: Level;
  rounds: string[];
  compare_round: string | null;
  anchor_round: string | null;
  version_mode: "extrapolated" | "matched";
  geo_scope: "state";
}

export interface Cell {
  value: number | null;
  delta: number | null;
  trend: (number | null)[];
  secondary: string | null;
  flags: string[];
  base: number | null;
}

export interface RoundItem {
  obs_id: string;
  label: string;
  base_name: string;
  cycle: string;
  series: string;
  round: number | null;
  dataset_id: string;
  version: "normal" | "extrapolated";
  fallback: boolean;
  seats: number;
  borrowed: number;
  seats_source: "metadata";
}

export interface RoundsBlock {
  items: RoundItem[];
  groups: { cycle: string; series: string; obs_ids: string[] }[];
  anchor: string; // obs_id
  compare: string | null; // obs_id
}

export interface PartReason { part: string; reason: string }
export interface NotAsked { part: string; rounds: string[] } // base names
export interface RunError { kind: string; message: string; fingerprint: string | null; jobs: string[] }
export interface RunStatus {
  state: "running" | "done" | "partial" | "failed";
  done: number;
  total: number;
  result: GridPayload | null;
  errors: Record<string, RunError>;
}

export interface PlanResponse {
  valid: true;
  errors: string[];
  unavailable: PartReason[];
  not_asked: NotAsked[];
  rounds: Omit<RoundItem, "cycle" | "series">[];
  coverage_mode: Record<string, string | null>;
}

export interface SurveyVersion {
  seats: number;
  borrowed: number;
  start_date: string | null;
  end_date: string | null;
}
export interface SurveyRound {
  base_name: string;
  label: string;
  round: number | null;
  versions: Partial<Record<"normal" | "extrapolated", SurveyVersion>>;
}
export interface SurveyGroup { group: string; cycle: string; series: string; rounds: SurveyRound[] }
export interface SurveysResponse {
  state: string;
  levels: Partial<Record<Level, SurveyGroup[]>>;
  skipped: { dataset_id: string; reason: string }[];
}

export interface PresentationRules {
  rowOrder?: string[] | Record<string, string[]>;
  columnOrder?: string[];
  pinLast?: string[];
  entityColors?: Record<string, string>;
}

// --- Card payload: mirrors matbodh_dashboard/cards/payload.py -------------------------
export type Family = "distribution" | "opinion" | "gender_differential";
export type CardMode = "standalone" | "compare" | "trend";
export type LensUnit = "percentage" | "percentage_points";

export interface LensDef { id: string; label: string; unit: LensUnit; has_delta: boolean }
export interface Capabilities { modes: CardMode[]; transpose: boolean; sort: boolean; details: boolean }
export interface FamilyMeta { family: Family; lenses: LensDef[]; default_lens: string; capabilities: Capabilities }
export interface GridColumn {
  key: string;
  label: string;
  scenario: string;
  kind: "party" | "option" | "scale";
  colour: string | null;
  lenses: string[] | null; // lenses this column applies to; null = all
}
export interface RowDef { key: string; labels: Record<string, string | null>; subtotal: string[] }
export interface CellValue { row: string; column: string; round: string | null; lens: string; value: number | null; status: string }
export interface DeltaValue {
  row: string;
  column: string;
  lens: string;
  target: string; // "<observation>:<scenario>"
  reference: string;
  value: number | null;
  reference_value: number | null;
  relative_change_pct: number | null;
  status: string;
}
export interface BaseDetail { row: string; column: string; round: string | null; fields: Record<string, unknown> }
export interface Cut {
  id: string;
  dimensions: string[];
  rows: RowDef[];
  cells: CellValue[];
  deltas: DeltaValue[];
  bases: BaseDetail[];
}
export interface GridPayload {
  family: Family;
  card_id: string;
  mode: CardMode;
  state: string;
  rounds: RoundsBlock;
  meta: FamilyMeta;
  columns: GridColumn[];
  cuts: Cut[];
  unavailable: PartReason[];
  not_asked: NotAsked[];
  coverage: { job: string; part: string; coverage: Record<string, unknown> | string }[];
  provenance: { contract: Record<string, unknown>; resolved_datasets: unknown };
  hidden_count: number;
  rules_version: string | number;
  engine_version: string;
  metadata_revision: number;
  alliance_epoch: number;
}

export interface CardFilterConfig { field: string; operator: "in" | "not_in"; values: string[] }
export interface CardInfo {
  id: string;
  family: Family;
  section: string;
  title: string;
  scenarios: string[];
  cuts: string[][];
  filters: CardFilterConfig[];
  comparison: { mode: CardMode; target: unknown; reference: unknown; delta_measures: string[] };
  caste_clubbing: boolean;
  requires: { min_level: "state" | "ac" };
  meta: FamilyMeta;
}
