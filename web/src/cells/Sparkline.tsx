const W = 64;
const H = 16;

/** Display-only scaling to the values' own min/max; nulls and breaks split segments. */
export function Sparkline({ values, breaks }: { values: (number | null)[]; breaks: number[] }) {
  const nums = values.filter((v): v is number => v !== null);
  const min = Math.min(...nums);
  const span = Math.max(...nums) - min || 1;
  const x = (i: number) => (values.length > 1 ? (i * W) / (values.length - 1) : W / 2);
  const y = (v: number) => H - 1 - ((v - min) / span) * (H - 2);
  const segments: string[][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      segments.push([]);
      return;
    }
    if (breaks.includes(i) || segments.length === 0) segments.push([]);
    segments[segments.length - 1].push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`trend across ${values.length} rounds`}>
      {segments.filter((s) => s.length > 0).map((s, i) =>
        s.length === 1 ? (
          <circle key={i} cx={s[0].split(",")[0]} cy={s[0].split(",")[1]} r={1.5} fill="currentColor" />
        ) : (
          <polyline key={i} points={s.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} />
        ),
      )}
    </svg>
  );
}
