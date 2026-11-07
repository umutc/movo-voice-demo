import { listCallMetrics } from 'db/read';
import { PageHeader, SectionHead, Status, td, th } from '@/components/console/ui';
import { databaseUrl, readLastEvalRun } from '@/lib/console/data';
import { ms } from '@/lib/console/format';
import { summarizeMetrics } from '@/lib/console/stats';

const f2 = (n: number) => n.toFixed(2);

export default async function QualityPage() {
  const rows = await listCallMetrics(databaseUrl());
  const lat = summarizeMetrics(rows.map((r) => r.metrics));
  const shown = lat.metrics.filter((m) => m.n > 0);
  const e2e = lat.metrics.find((m) => m.key === 'e2eMs');
  const run = readLastEvalRun();
  const invPass = run ? run.scenarios.length - run.totals.invariantsFailed : 0;
  const stylePass = run ? run.scenarios.length - run.totals.styleFailures : 0;

  return (
    <>
      <PageHeader
        title="Quality"
        lead={
          run
            ? `Last eval run ${run.date}, ${run.profile} profile, ${run.scenarios.length} scenarios on fakes. Latency from ${lat.turns} recorded turns in ${rows.length} calls.`
            : `Latency from ${lat.turns} recorded turns in ${rows.length} calls.`
        }
      />

      {run ? (
        <section className="card flex flex-wrap items-center gap-8 px-7 py-6">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[40px] leading-none" style={{ fontWeight: 700 }}>
              {run.pass ? 'Pass' : 'Fail'}
            </span>
            <span className="text-[15px] text-text-muted">
              eval gate, {run.n} {run.profile} scenarios
            </span>
          </div>
          <div className="flex flex-1 flex-wrap gap-x-6 gap-y-1.5 text-[14px] text-text-secondary">
            <span>
              <strong className="text-text">
                {invPass} of {run.scenarios.length}
              </strong>{' '}
              scenarios with all invariants passing
            </span>
            <span>
              <strong className="text-text">{f2(run.totals.goalMean)}</strong> goal completion
            </span>
            <span>
              <strong className="text-text">{f2(run.totals.groundingMean)}</strong> grounding
            </span>
            <span>
              <strong className="text-text">
                {stylePass} of {run.scenarios.length}
              </strong>{' '}
              style checks
            </span>
          </div>
          {run.failures.length > 0 && <span className="caption w-full">Gate failures: {run.failures.join('; ')}</span>}
        </section>
      ) : (
        <section className="card px-7 py-6 text-[14px] text-text-secondary">
          No eval output in this deployment; run <span className="mono text-[13px]">pnpm eval --profile core</span>
        </section>
      )}

      <div className="flex flex-wrap items-start gap-5">
        {run && (
          <section className="card flex min-w-0 flex-[999_1_560px] flex-col overflow-x-auto">
            <SectionHead title="Scenarios" />
            <table className="w-full border-collapse text-[13px]">
              <thead className="text-text-muted">
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Scenario</th>
                  <th className={th}>Turns</th>
                  <th className={th}>Goal</th>
                  <th className={th}>Grounding</th>
                  <th className={th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {run.scenarios.map((s) => {
                  const problems = [...s.failedInvariants, ...(s.stylePass ? [] : ['style'])];
                  return (
                    <tr key={s.scenarioId}>
                      <td className={`${td} mono`}>{s.scenarioId}</td>
                      <td className={td}>{s.title}</td>
                      <td className={`${td} mono`}>{s.turns}</td>
                      <td className={`${td} mono`}>{f2(s.goal)}</td>
                      <td className={`${td} mono`}>{f2(s.grounding)}</td>
                      <td className={td}>
                        {problems.length === 0 ? (
                          <Status dot="dot dot-on">
                            <span className="text-accent-strong">Pass</span>
                          </Status>
                        ) : (
                          <Status dot="dot dot-warning">{`Check: ${problems.join(', ')}`}</Status>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
        <section className="card flex min-w-0 max-w-[420px] flex-[1_1_340px] flex-col">
          <SectionHead title={`Latency, ${lat.turns} turns`} />
          {shown.length === 0 ? (
            <p className="px-6 pb-6 text-[13px] text-text-muted">No latency values recorded yet.</p>
          ) : (
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 px-6 pb-5 text-[13px]">
              <span />
              <span className="text-right text-text-muted">p50</span>
              <span className="text-right text-text-muted">p95</span>
              <span className="text-right text-text-muted">n</span>
              {shown.map((m) => (
                <Row key={m.key} label={m.label} p50={m.p50} p95={m.p95} n={m.n} />
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1 border-t border-divider px-6 py-4 text-[13px]">
            <span>
              <strong>{lat.interruptions}</strong> interruptions across {rows.length} calls
            </span>
            {e2e && e2e.n > 0 && (
              <span className="caption">Nearest-rank percentiles over turns that reported a value, same math as pnpm report:latency.</span>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Row({ label, p50, p95, n }: { label: string; p50: number | null; p95: number | null; n: number }) {
  return (
    <>
      <span className="text-text-secondary">{label}</span>
      <span className="mono text-right text-[13px]">{ms(p50)}</span>
      <span className="mono text-right text-[13px]">{ms(p95)}</span>
      <span className="mono text-right text-[13px] text-text-muted">{n}</span>
    </>
  );
}
