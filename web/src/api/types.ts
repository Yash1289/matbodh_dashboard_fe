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
export interface SeriesLabel { series: string; label: string; colour: string | null }

export interface ScoreboardRow extends SeriesLabel {
  flags: string[];
  vote: Cell | null;
  seats_ac: Cell | null;
  seats_pc: Cell | null;
  gender_gap: Cell | null;
}
export interface OpinionRow extends SeriesLabel { cell: Cell | null }
export interface SeriesCell extends SeriesLabel {
  cell: Cell | null;
  lenses?: Record<string, Cell | null>;
}
export interface GridRow {
  value: string | null;
  label: string | null;
  series: (SeriesLabel & { cell: Cell | null; lenses?: Record<string, Cell | null> })[];
}

export interface RankedItem {
  rank: number;
  label: string;
  value: number | null;
  delta: number | null;
  measure: "net_score" | "positive_share" | "negative_share" | "support_share" | string;
  kind?: "difference" | "shakti" | string;
  secondary?: string | null;
  tags?: string[];
  colour?: string | null;
}

export interface RankedPartition {
  partition_key: string;
  partition_label: string;
  items: RankedItem[];
}

export interface RankedListResult {
  measure: string;
  kind?: string;
  polarity: "highest_first" | "lowest_first";
  partitions: RankedPartition[];
  total_ranked: number;
}

export interface TransitionCell {
  origin: string;
  destination: string;
  origin_share: number;
  destination_share: number;
  joint_share: number;
}

export interface TransitionMatrixResult {
  origins: string[];
  destinations: string[];
  matrix: Record<string, Record<string, TransitionCell>>;
}

export interface BattlegroundSeat {
  seat_id: string;
  winner: string;
  margin_pp: number;
  flip: string;
}

export interface BattlegroundMarginBucket {
  bucket: string;
  count: number;
  seat_ids: string[];
}

export interface BattlegroundResult {
  flips: { winning_both: number; gain: number; loss: number; losing_both: number };
  margin_buckets: BattlegroundMarginBucket[];
  seats: BattlegroundSeat[];
}

export interface CardResult {
  card_id: string;
  operation: "scoreboard" | "opinion" | "distribution" | "ranked_list" | "transition" | "battleground";
  state: string;
  rounds: RoundsBlock;
  unavailable: PartReason[];
  not_asked: NotAsked[];
  coverage: { job: string; part: string; coverage: Record<string, unknown> | string }[];
  rules_version: string | number;
  engine_version: string;
  metadata_revision: number;
  alliance_epoch: number;
  hidden_count: number;
  scoreboard?: ScoreboardRow[];
  opinion?: OpinionRow[];
  not_returned?: string[];
  grid?: { row_dim: string; rows: GridRow[] };
  ranked_list?: RankedListResult;
  transition?: TransitionMatrixResult;
  battleground?: BattlegroundResult;
}

export interface RunError { kind: string; message: string; fingerprint: string | null; jobs: string[] }
export interface RunStatus {
  state: "running" | "done" | "partial" | "failed";
  done: number;
  total: number;
  result: CardResult | null;
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
  rowOrder?: string[];
  columnOrder?: string[];
  pinLast?: string[];
  entityColors?: Record<string, string>;
}

export interface SlicerSpec {
  dimension: string;
  label: string;
  options: string[];
  selected: string;
}

export interface FilterSpec {
  id: string;
  label: string;
  options: string[];
  selected?: string;
}

export interface Template {
  id: string;
  section: string;
  title: string;
  operation: "scoreboard" | "distribution" | "opinion" | "ranked_list" | "transition" | "battleground" | string;
  body_adapter?: "composite_grid" | "ranked_list" | "transition_matrix" | "battleground_summary" | string;
  lenses?: { default: string; options: string[] };
  presentation?: { row_field?: string; col_field?: string; slicer?: string };
  slicers?: SlicerSpec[];
  filters?: FilterSpec[];
  presentationRules?: PresentationRules;
  questions: string[];
  measures: string[];
  slices: string[];
  cell: CellPart[];
  density: Density;
  requires: { min_level: "state" | "ac"; focus_party: boolean };
}
