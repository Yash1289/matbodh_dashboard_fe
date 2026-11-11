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
  result: CardPayload | null;
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
export type GridFamily = "distribution" | "opinion" | "gender_differential";
export type RankingFamily = "seat_ranking" | "demographic_ranking";
export type BenchmarkFamily = "seat_benchmark";
export type Family = GridFamily | RankingFamily | BenchmarkFamily;
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

// --- Ranked payload: mirrors matbodh_dashboard/cards/ranking/payload.py -----------------
export type AbsentReason = "outside_top_k" | "not_ranked" | "round_failed";
export interface RankedEntity { key: string; labels: Record<string, string | null> }
export interface RankedGroup {
  key: string;
  partition: Record<string, string | null>;
  entities: string[]; // entity keys in display order (anchor rank, then engine order)
  eligible_count: Record<string, number | null>; // by observation id
}
export interface RankedValue {
  entity: string;
  group: string;
  round: string;
  rank: number | null;
  value: number | null;
  target_value: number | null;
  reference_value: number | null;
  target_base: number | null;
  reference_base: number | null;
  weighted_denominator: number | null;
  unweighted_base: number | null;
  status: string;
  flags: string[];
}
export interface AbsentSlot { entity: string; group: string; round: string; reason: AbsentReason }
export interface RankedPayload {
  kind: "ranked";
  family: RankingFamily;
  card_id: string;
  mode: CardMode;
  state: string;
  rounds: RoundsBlock;
  entity_kind: "seat" | "demographic";
  level: string;
  partition_by: string[];
  top_k: number | null;
  direction: string | null;
  unit: string | null;
  groups: RankedGroup[];
  entities: RankedEntity[];
  ranks: RankedValue[];
  absent: AbsentSlot[];
  unavailable: PartReason[];
  not_asked: NotAsked[];
  coverage: { job: string; part: string; coverage: Record<string, unknown> | string }[];
  contracts: Record<string, Record<string, unknown>>;
  rules_version: string | number;
  engine_version: string;
  metadata_revision: number;
  alliance_epoch: number;
}

// --- Benchmark payload: mirrors matbodh_dashboard/cards/benchmark/payload.py ---------------
export type BenchmarkTable = "comparison" | "summary" | "margin_buckets" | "flips";
export type BenchmarkSide = "target" | "reference";
export interface BenchmarkGroup { set_id: string; dimensions: Record<string, string> }
export interface BenchmarkSummaryRow {
  endpoint: BenchmarkSide;
  group: BenchmarkGroup;
  party: string;
  eligible_seats: number;
  seats: number | null;
  seat_share: number | null;
  vote_share: number | null;
  support_mass: number | null;
  support_base: number | null;
  absent: "not_in_endpoint_mapping" | null;
}
export interface BenchmarkComparisonRow {
  group: BenchmarkGroup;
  party: string;
  eligible_seats: number;
  target_vote_share: number | null;
  reference_vote_share: number | null;
  vote_share_delta_pp: number | null;
  target_seats: number | null;
  reference_seats: number | null;
  seat_delta: number | null;
  seat_share_delta_pp: number | null;
  absent_sides: BenchmarkSide[];
}
export interface BenchmarkBucketRow { endpoint: BenchmarkSide; group: BenchmarkGroup; bucket: string; seats: number; eligible_seats: number }
export interface BenchmarkFlipRow { group: BenchmarkGroup; bucket: string; seats: number; eligible_seats: number }
export interface BenchmarkReference { kind: "none" | "compare" | "election"; year?: number; election_type?: "LS" | "VS" }
export interface ElectionOption { year: number; election_type: "LS" | "VS"; label: string }
export interface BenchmarkPayload {
  kind: "benchmark";
  family: BenchmarkFamily;
  card_id: string;
  state: string;
  rounds: RoundsBlock;
  reference: { kind: BenchmarkReference["kind"]; label: string | null };
  focal_party: string | null;
  parties: string[]; // the major parties; Other is separate
  other_label: string;
  endpoint_parties: Record<string, string[]>;
  tables_available: BenchmarkTable[];
  default_table: BenchmarkTable;
  comparisons: BenchmarkComparisonRow[];
  summaries: BenchmarkSummaryRow[];
  margin_buckets: BenchmarkBucketRow[];
  flips: BenchmarkFlipRow[];
  contract: Record<string, unknown>;
  unavailable: PartReason[];
  rules_version: string | number;
  engine_version: string;
  metadata_revision: number;
  alliance_epoch: number;
}

/** What /runs returns for any card: a grid, a ranking or a benchmark. */
export type CardPayload = GridPayload | RankedPayload | BenchmarkPayload;
export const isBenchmarkPayload = (p: CardPayload): p is BenchmarkPayload => "kind" in p && p.kind === "benchmark";
export const isBenchmarkFamily = (f: Family): f is BenchmarkFamily => f === "seat_benchmark";
export const isRankedPayload = (p: CardPayload): p is RankedPayload => "kind" in p && p.kind === "ranked";
export const isRankingFamily = (f: Family): f is RankingFamily => f === "seat_ranking" || f === "demographic_ranking";

export interface RankInfo {
  metric: string;
  party_id: string | null;
  level: string;
  partition_by: string[];
  filters: CardFilterConfig[];
  top_k: number | null;
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
  rank?: RankInfo | null; // ranking families only
  view?: { table: BenchmarkTable | null } | null; // benchmark family only
}
