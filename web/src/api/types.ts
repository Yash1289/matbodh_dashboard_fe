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
  /** The session cohort (seats the user selected); sent with every request, never part of the URL. */
  cohort?: CohortRef | null;
}

export interface CohortRef {
  seat_level: "ac" | "pc";
  seat_ids: number[];
  label: string;
  created_at: string;
}

/** What the user asks of a seat ranking (rank_*, metric_*) or a seat benchmark (the rest); never both. */
export interface SelectionPredicate {
  rank_max?: number;
  metric_min?: number;
  metric_max?: number;
  endpoint?: "target" | "reference";
  status?: "winning" | "losing";
  margin_min?: number;
  margin_max?: number;
  flip?: "gain" | "loss" | "winning_both" | "losing_both";
}

export interface CohortPreview {
  kind: "cohort_preview";
  seat_level: "ac" | "pc";
  seat_ids: number[];
  count: number;
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
export type RelationshipFamily = "relationship";
export type Family = GridFamily | RankingFamily | BenchmarkFamily | RelationshipFamily;
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

// --- Relationship payload: mirrors matbodh_dashboard/cards/relationship/payload.py ----------
export type RelationshipTable = "summary" | "matrix";
export interface RelationshipGroup { set_id: string; dimensions: Record<string, string> }
export interface RelationshipCell {
  round: string;
  group: RelationshipGroup;
  origin: string;
  destination: string;
  origin_share: number | null;
  destination_share: number | null;
  joint_share: number | null;
  size_of_impact_pp: number | null;
  joint_count: number | null;
  joint_mass: number | null;
  origin_base: number | null;
  destination_base: number | null;
  paired_base: number | null;
  paired_count: number | null;
  absent: "no_respondents" | null;
}
export interface RelationshipSummary {
  round: string;
  group: RelationshipGroup;
  paired_count: number | null;
  paired_base: number | null;
  agreement_share: number | null;
  agreement_mass: number | null;
  composition_share: number | null;
  agreement_size_of_impact_pp: number | null;
  // With a focal party only (null otherwise):
  retention_share: number | null;
  loss_share: number | null;
  acquisition_share: number | null;
  conversion_share: number | null;
  retained_population_share: number | null;
  lost_population_share: number | null;
  gained_population_share: number | null;
  neither_population_share: number | null;
  net_flow_pp: number | null;
  net_flow_size_of_impact_pp: number | null;
  retention_size_of_impact_pp: number | null;
  loss_size_of_impact_pp: number | null;
  acquisition_size_of_impact_pp: number | null;
  conversion_size_of_impact_pp: number | null;
  retained_population_impact_pp: number | null;
  gained_population_impact_pp: number | null;
  lost_population_impact_pp: number | null;
  neither_population_impact_pp: number | null;
  focal_origin_base: number | null;
  focal_destination_base: number | null;
  retained_mass: number | null;
  lost_mass: number | null;
  gained_mass: number | null;
  neither_mass: number | null;
}
export interface RelationshipPayload {
  kind: "relationship";
  family: RelationshipFamily;
  card_id: string;
  state: string;
  rounds: RoundsBlock;
  origin: string;
  destination: string;
  focal_party: string | null;
  weights: Record<string, unknown>;
  answer_overrides: Record<string, { include: string[] }> | null; // recalled statuses restored on an endpoint
  parties: string[]; // the major parties, in display order
  groups: RelationshipGroup[];
  tables_available: RelationshipTable[];
  default_table: RelationshipTable;
  cells: RelationshipCell[];
  summaries: RelationshipSummary[];
  contract: Record<string, unknown>;
  not_asked: NotAsked[];
  unavailable: PartReason[];
  rules_version: string | number;
  engine_version: string;
  metadata_revision: number;
  alliance_epoch: number;
}

/** What /runs returns for any card: a grid, a ranking, a benchmark or a relationship. */
export type CardPayload = GridPayload | RankedPayload | BenchmarkPayload | RelationshipPayload;
export const isRelationshipPayload = (p: CardPayload): p is RelationshipPayload => "kind" in p && p.kind === "relationship";
export const isRelationshipFamily = (f: Family): f is RelationshipFamily => f === "relationship";
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
  view?: { table: BenchmarkTable | RelationshipTable | null } | null; // benchmark and relationship families only
  pipe_rounds?: number | null;
  display_parties?: string[];
  /** A card configured by the analyst (kept in the browser), not a library card from the server. */
  inline?: boolean;
}

// --- A card sent from the browser: mirrors matbodh_dashboard/cards/config.py (CardConfig) -------------
export interface EndpointJson { round?: "anchor" | "compare"; scenario?: string }
export interface CardConfigJson {
  id: string;
  family: Family;
  title: string;
  section?: string;
  scenarios?: string[];
  all_party_scenarios?: boolean;
  cuts?: string[][];
  filters?: CardFilterConfig[];
  comparison?: { mode?: CardMode; target?: EndpointJson | null; reference?: EndpointJson | null; delta_measures?: string[] };
  caste_clubbing?: boolean;
  requires?: { min_level: "state" | "ac" };
  rank?: {
    metric?: string; party_id?: string | null; level?: string; partition_by?: string[];
    filters?: CardFilterConfig[]; top_k?: number | null;
  } | null;
  benchmark?: {
    focal_party?: string | null; grouping_sets?: string[][]; reference?: BenchmarkReference | null;
    contenders?: string[] | null;
  } | null;
  relationship?: {
    origin?: string; destination?: string; focal_party?: string | null;
    include_recalled?: Partial<Record<"origin" | "destination", string[]>>;
    joint_weight?: { source: "base" | "scenario"; scenario?: string | null };
  } | null;
  view?: { table: BenchmarkTable | RelationshipTable | null } | null;
  pipe_rounds?: number | null;
  display_parties?: string[];
}

/** Which card a request is about: a library card by id, or the full config sent inline. */
export type CardRef = { card_id: string } | { card: CardConfigJson };

export const toCardRef = (info: CardInfo): CardRef => {
  if (!info.inline) return { card_id: info.id };
  const { meta: _meta, inline: _inline, ...config } = info;
  return { card: config as unknown as CardConfigJson };
};

// --- Configure: mirrors matbodh_dashboard/cards/configure/ ---------------------------------------------
export type Condition =
  | { op: "equals"; path: string; value: string | number | boolean | null }
  | { op: "in"; path: string; values: (string | number | boolean)[] }
  | { op: "nonempty"; path: string }
  | { op: "contains"; path: string; value: string }
  | { op: "kind_of"; path: string; kind: "party" | "opinion" | "recalled" }
  | { op: "count_at_least"; path: string; n: number }
  | { op: "all"; of: Condition[] }
  | { op: "any"; of: Condition[] }
  | { op: "not"; of: Condition };

export type Widget =
  | "scenario_picker" | "metric_picker" | "cut_builder" | "filter_list" | "party_picker"
  | "election_picker" | "number" | "toggle" | "choice" | "text" | "slot";

export interface OptionSource { source: string; params?: Record<string, string | number | boolean> }
export interface FieldDescriptor {
  path: string;
  label: string;
  help?: string;
  widget: Widget;
  required: boolean;
  tier: "primary" | "more";
  show_when?: Condition;
  options?: OptionSource;
  choices?: string[];
  default?: string | number | boolean | unknown[];
  limits?: Record<string, number>;
  multiple: boolean;
}
export interface FamilyDescriptor {
  family: Family;
  label: string;
  description: string;
  fields: FieldDescriptor[];
  meta: FamilyMeta;
}
export interface OptionItem {
  value: string;
  label: string;
  kind: string | null;
  recalled: boolean;
  disabled_reason: string | null;
}
export interface ValidateResponse {
  valid: boolean;
  errors: { path: string; message: string }[];
  unavailable: { reason: string }[];
  not_asked: { part: string; rounds: string[] }[];
  notes: string[];
  rounds: RoundItem[];
}
export interface FilterValues { kind: "filter_values"; field: string; values: string[] }
