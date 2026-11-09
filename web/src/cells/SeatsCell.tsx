import type { Cell, CellPart, RoundsBlock } from "../api/types";
import { formatValue } from "./format";
import { deltaTitle } from "./parts";
import { CellFrame, Dash, Delta, Flags, cellDeltaTitle, reasonOf } from "./pieces";

interface Props {
  ac: Cell | null;
  pc: Cell | null;
  rounds: RoundsBlock;
  parts: CellPart[];
}

const isMissing = (c: Cell | null): boolean => c === null || c.value === null;
const SEP = " · ";

/** AC and PC seats in one cell; a missing level stays visible as "—" with its reason. */
export function SeatsCell({ ac, pc, rounds, parts }: Props) {
  const has = (p: CellPart) => parts.includes(p);
  const dTitle = deltaTitle(rounds);

  if (isMissing(ac) && isMissing(pc)) {
    const reason = [...new Set([reasonOf(ac), reasonOf(pc)])].join("; ");
    return <CellFrame value={<Dash title={reason} />} delta={null} sub={[<span key="r">{reason}</span>]} />;
  }

  const level = (c: Cell | null, suffix = "") =>
    isMissing(c) ? <Dash title={reasonOf(c)} /> : `${formatValue(c!.value, "seats")}${suffix}`;
  const delta = (c: Cell | null) => <Delta delta={c?.delta ?? null} unit="seats" title={dTitle === null ? undefined : cellDeltaTitle(c, dTitle)} />;
  const at = (c: Cell | null, i: number) => formatValue(c?.trend[i] ?? null, "seats");

  const sub = [];
  if (has("trend") && rounds.items.length > 0) {
    sub.push(<span key="trend">{rounds.items.map((r, i) => `${r.label} ${at(ac, i)}${SEP}${at(pc, i)}`).join(" | ")}</span>);
  }
  const secondary = [ac?.secondary, pc?.secondary].filter((s): s is string => s != null);
  if (has("secondary") && secondary.length > 0) sub.push(<span key="secondary">{secondary.join(SEP)}</span>);
  if (has("flags")) sub.push(<Flags key="flags" flags={[...new Set([...(ac?.flags ?? []), ...(pc?.flags ?? [])])]} />);

  return (
    <CellFrame
      value={has("value") ? <>{level(ac, ac?.flags.includes("borrowed") ? "*" : "")}{SEP}{level(pc)}</> : null}
      delta={has("delta") && dTitle !== null ? <span>{delta(ac)}{SEP}{delta(pc)}</span> : null}
      sub={sub}
    />
  );
}
