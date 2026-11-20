/** The mark: a ballot tick over rising bars (a vote, then understanding it). `onDark` is for the deep-ink top bar. */
export function Mark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill={onDark ? "var(--mb-saffron)" : "var(--mb-deep-ink)"} />
      <rect x="6.5" y="17" width="4.5" height="8.5" rx="1.2" fill={onDark ? "var(--mb-deep-ink)" : "var(--mb-surface)"} />
      <rect x="13.75" y="12.5" width="4.5" height="13" rx="1.2" fill={onDark ? "var(--mb-deep-ink)" : "var(--mb-surface)"} />
      <rect x="21" y="8" width="4.5" height="17.5" rx="1.2" fill={onDark ? "var(--mb-deep-ink)" : "var(--mb-surface)"} />
      <path d="M6 7.5l2.6 2.7L13.6 4.6" fill="none" stroke={onDark ? "var(--mb-surface)" : "var(--mb-accent)"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
