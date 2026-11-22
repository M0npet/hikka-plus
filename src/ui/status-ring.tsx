/** Кружечок стану: порожній — не читав, сектор — прочитано частину, ✓ — прочитано. */
export function StatusRing({ pos, read }: { pos: number; read: boolean }) {
  const r = 8;
  const len = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      {read ? (
        <>
          <circle cx="10" cy="10" r={r} fill="currentColor" />
          <path d="m6.5 10.2 2.3 2.3 4.7-4.9" fill="none" stroke="var(--hp-bg)" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        pos > 0.01 && (
          <circle
            cx="10"
            cy="10"
            r={r}
            fill="none"
            stroke="var(--hp-primary-fg)"
            strokeWidth="2"
            strokeDasharray={`${len * pos} ${len}`}
            transform="rotate(-90 10 10)"
          />
        )
      )}
    </svg>
  );
}
