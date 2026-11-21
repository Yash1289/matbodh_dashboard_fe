import styles from "./FamilyPreview.module.css";

/**
 * A drawn glimpse of what a card family shows. The data is sensitive, so every figure is the placeholder "xx%":
 * the shapes say how the card reads, never what the survey found.
 */
const PH = "xx%";
const TONES = ["saffron", "mint", "sky"] as const;

function Table() {
  return (
    <div className={styles.table}>
      {TONES.map((t) => <span key={t} className={styles.head} data-tone={t} />)}
      {Array.from({ length: 6 }, (_, i) => <span key={i} className={styles.cell}>{PH}</span>)}
    </div>
  );
}

function Opinion() {
  return (
    <div className={styles.bars}>
      <div className={styles.barRow}><i data-tone="mint" style={{ "--w": "62%" } as React.CSSProperties} /><span>{PH}</span></div>
      <div className={styles.barRow}><i data-tone="saffron" style={{ "--w": "38%" } as React.CSSProperties} /><span>{PH}</span></div>
      <div className={styles.net}><span>Net</span><b>{PH}</b></div>
    </div>
  );
}

function Gap() {
  return (
    <div className={styles.pair}>
      {["Women", "Men"].map((g, i) => (
        <div key={g} className={styles.col}>
          <i data-tone={i === 0 ? "saffron" : "sky"} style={{ "--h": i === 0 ? "70%" : "52%" } as React.CSSProperties} />
          <span>{g}</span><b>{PH}</b>
        </div>
      ))}
    </div>
  );
}

function Ranking() {
  return (
    <ol className={styles.rank}>
      {[78, 61, 44].map((w, i) => (
        <li key={w}><em>{i + 1}</em><i data-tone={TONES[i]} style={{ "--w": `${w}%` } as React.CSSProperties} /><span>{PH}</span></li>
      ))}
    </ol>
  );
}

function Benchmark() {
  return (
    <div className={styles.pair}>
      {["Then", "Now"].map((g, i) => (
        <div key={g} className={styles.col}>
          <i data-tone={i === 0 ? "sky" : "saffron"} style={{ "--h": i === 0 ? "46%" : "64%" } as React.CSSProperties} />
          <span>{g}</span><b>{PH}</b>
        </div>
      ))}
    </div>
  );
}

function Movement() {
  return (
    <svg className={styles.flow} viewBox="0 0 160 80" aria-hidden="true">
      <g strokeWidth="6" strokeLinecap="round" fill="none">
        <path d="M18 14 C70 14 90 14 142 14" stroke="var(--mb-saffron)" opacity=".85" />
        <path d="M18 14 C70 14 90 40 142 40" stroke="var(--mb-saffron)" opacity=".35" />
        <path d="M18 66 C70 66 90 66 142 66" stroke="var(--mb-sky)" opacity=".85" />
        <path d="M18 66 C70 66 90 40 142 40" stroke="var(--mb-mint)" opacity=".5" />
      </g>
      <text x="80" y="11" textAnchor="middle" fontSize="9" fill="var(--mb-muted)">{PH}</text>
    </svg>
  );
}

const SHAPES: Record<string, () => JSX.Element> = {
  distribution: Table, opinion: Opinion, gender_differential: Gap,
  seat_ranking: Ranking, demographic_ranking: Ranking, seat_benchmark: Benchmark, relationship: Movement,
};

export function FamilyPreview({ family }: { family: string }) {
  const Shape = SHAPES[family] ?? Table;
  return <div className={styles.preview} aria-hidden="true"><Shape /></div>;
}
