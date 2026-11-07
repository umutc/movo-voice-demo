export function Wordmark({ full = false }: { full?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <svg width="30" height="22" viewBox="0 0 30 22" fill="none" stroke="#166534" strokeWidth="2" aria-hidden="true">
        <rect x="1" y="1" width="28" height="20" rx="2" />
        <path d="M15 1v20" />
        <circle cx="15" cy="11" r="3.5" />
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="font-display text-[15px] font-700" style={{ fontWeight: 700 }}>
          BYSA
        </span>
        {full && <span className="caption">Brooklyn Youth Soccer Academy</span>}
      </div>
    </div>
  );
}

export function SiteHeader({ children, full = false }: { children?: React.ReactNode; full?: boolean }) {
  return (
    <header className="flex items-center justify-between gap-6 border-b border-border bg-surface px-10 py-[18px]">
      <Wordmark full={full} />
      {children}
    </header>
  );
}

export function MicIcon({ color = '#FFFFFF' }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
