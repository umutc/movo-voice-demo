import Link from 'next/link';

export function PageHeader({ title, lead, children }: { title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] tracking-[-0.01em]" style={{ fontWeight: 700 }}>
          {title}
        </h1>
        {lead && <span className="text-[14px] text-text-muted">{lead}</span>}
      </div>
      {children}
    </div>
  );
}

export function SectionHead({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
      <h2 className="font-display text-[15px]" style={{ fontWeight: 600 }}>
        {title}
      </h2>
      {href && linkLabel && (
        <Link href={href} className="text-[13px] font-medium text-accent hover:text-accent-strong">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

export function Status({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={dot} />
      {children}
    </span>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-semibold tracking-[0.06em] text-text-muted uppercase">{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-6 pb-6 text-[13px] text-text-muted">{children}</p>;
}

export const th = 'whitespace-nowrap border-b border-border px-3 py-2.5 text-left font-medium first:pl-6 last:pr-6';
export const td = 'border-b border-divider px-3 py-3 align-top first:pl-6 last:pr-6';
