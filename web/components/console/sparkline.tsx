/** Inline SVG polyline, one point per value. The label carries the values for screen readers. */
export function Sparkline({ values, label, width = 220, height = 56 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [2 + i * step, height - 4 - (v / max) * (height - 8)] as const);
  const last = pts.at(-1);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke="#166534" strokeWidth="2" strokeLinejoin="round" />
      {last && <circle cx={last[0]} cy={last[1]} r="3" fill="#166534" />}
    </svg>
  );
}
