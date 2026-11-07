// Braintrust tracing: one trace per call (PRD section 12).
//
// Layer 1, OpenTelemetry: @livekit/agents emits its own spans (agent_session, user_turn,
// agent_turn, llm_node, tts_node, function_tool, ...). We install a NodeTracerProvider whose
// BatchSpanProcessor exports them over OTLP to Braintrust, plus the SDK's FanoutSpanProcessor so
// LiveKit Cloud tracing can still attach its own processor to the same provider.
// Endpoint and headers: https://docs.braintrust.dev/integrations/sdk-integrations/opentelemetry/send-traces-and-logs
// (traces at https://api.braintrust.dev/otel/v1/traces, `Authorization: Bearer <key>`,
// `x-bt-parent: project_name:<name>`).
//
// Layer 2, manual Braintrust spans: a root "call" span per session, one child per tool execution,
// and the summary and outcome logged on the root at the end.
//
// One trace per call: Braintrust keys an OTLP span's trace by its OTel trace id (root_span_id) and
// the Braintrust SDK issues OTel-shaped ids (32-hex root_span_id, 16-hex span_id). The exporter
// below rewrites every exported SDK span into the call span's trace and hangs the top-level ones
// under the call span. (`x-bt-parent: <span slug>` is documented for this, but the endpoint
// answered 403 "Missing update access to span id trace" for every slug we tried on 2026-11-07.)
//
// Tracing never breaks a call: every error is caught and logged, and shutdown is time-boxed.
import { type AgentSession, AgentSessionEventTypes, log, telemetry } from '@livekit/agents';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { ReadableSpan, Span as OtelSdkSpan, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-node';
import { initLogger, type Logger, type Span } from 'braintrust';
import type { SessionContext } from './context.ts';

const BRAINTRUST_OTLP_TRACES_URL = 'https://api.braintrust.dev/otel/v1/traces';
/** How long an OTLP export waits for the call span before it exports the spans unchanged. */
const ROOT_WAIT_MS = 15_000;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
/** Upper bound for the whole shutdown (Braintrust flush, then OTel flush). */
const SHUTDOWN_BUDGET_MS = 9_000;

export interface TracingOptions {
  enabled: boolean;
  apiKey?: string | undefined;
  project: string;
  /** Attributes added to every SDK span (room, job, agent name). */
  metadata: Record<string, string>;
}

export interface CallFinish {
  summary: string | null;
  outcome: string;
}

export interface TracingHandle {
  /** Starts the root "call" span. Call once, after the session context exists. */
  startCall(sc: SessionContext): void;
  /** Subscribes to tool executions and creates one child span per tool call. */
  attach(session: AgentSession<SessionContext>): void;
  /** Logs summary, outcome, booking and callback ids on the root span and ends it. */
  finish(sc: SessionContext, result: CallFinish): void;
  /** Ends the root span, flushes Braintrust, then flushes the OTel provider (bounded, never throws). */
  shutdown(): Promise<void>;
  /** Braintrust root span id of this call (for `calls.trace_id`), or null before startCall. */
  readonly traceId: string | null;
}

function warn(err: unknown, msg: string): void {
  const error = err instanceof Error ? err.message : String(err);
  try {
    log().warn({ error }, msg);
  } catch {
    // Logger not initialized (scripts, tests): fall back to stderr.
    console.warn(`[tracing] ${msg}: ${error}`);
  }
}

function safe<T>(fn: () => T, msg: string): T | undefined {
  try {
    return fn();
  } catch (err) {
    warn(err, msg);
    return undefined;
  }
}

/** Resolves after `ms` with `undefined`; the timer does not keep the process alive. */
function delay(ms: number): Promise<undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms).unref());
}

function parseArgs(args: string): unknown {
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return args;
  }
}

/** Records the ids of spans this provider started, so the exporter can spot foreign parents. */
class SeenSpanIds implements SpanProcessor {
  readonly ids = new Set<string>();
  onStart(span: OtelSdkSpan): void {
    this.ids.add(span.spanContext().spanId);
  }
  onEnd(): void {}
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/** Trace id and span id of the Braintrust call span, in OTel shape. */
interface RootIds {
  traceId: string;
  spanId: string;
}

/**
 * Moves the SDK's spans into the call span's trace before export.
 *
 * The job root span (`job_entrypoint`) is created by the framework before the entry function runs,
 * on LiveKit's own provider, so it never reaches Braintrust; without a LiveKit Cloud provider each
 * top-level SDK span would even start its own trace. Here every span gets the call's trace id,
 * and a span whose parent this provider never started (or that has no parent) gets the call span
 * as its parent. Only the Braintrust export sees the rewrite: LiveKit Cloud's processor gets the
 * untouched span.
 */
class CallTraceExporter implements SpanExporter {
  private readonly inner: SpanExporter;
  private readonly seen: SeenSpanIds;
  private readonly root: Promise<RootIds | null>;

  constructor(inner: SpanExporter, seen: SeenSpanIds, root: Promise<RootIds | null>) {
    this.inner = inner;
    this.seen = seen;
    this.root = root;
  }

  export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter['export']>[1]): void {
    void Promise.race([this.root, delay(ROOT_WAIT_MS)]).then((root) => {
      let out = spans;
      try {
        if (root) out = spans.map((span) => this.rewrite(span, root));
      } catch (err) {
        warn(err, 'tracing: span rewrite failed, exporting unchanged');
        out = spans;
      }
      this.inner.export(out, resultCallback);
    });
  }

  private rewrite(span: ReadableSpan, root: RootIds): ReadableSpan {
    const own = span.spanContext();
    const parent = span.parentSpanContext;
    const ownParent = parent && this.seen.ids.has(parent.spanId);
    const newParent = ownParent
      ? { ...parent, traceId: root.traceId }
      : { traceId: root.traceId, spanId: root.spanId, traceFlags: own.traceFlags, isRemote: true };
    // Shadow two members; everything else resolves through the prototype chain.
    return Object.create(span, {
      spanContext: { value: () => ({ ...own, traceId: root.traceId }) },
      parentSpanContext: { value: newParent, enumerable: true },
    }) as ReadableSpan;
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

let globalRegistered = false;

/**
 * Installs tracing for one job. Returns null when tracing is disabled or no API key is set; the
 * caller then skips every tracing call. Call it in the job entry before `session.start()`.
 */
export function setupTracing(opts: TracingOptions): TracingHandle | null {
  if (!opts.enabled || !opts.apiKey) return null;
  const apiKey = opts.apiKey;

  // Call span ids. Exports wait for them (bounded) so every SDK span lands in the call's trace.
  let resolveRoot: (ids: RootIds | null) => void = () => {};
  const rootReady = new Promise<RootIds | null>((resolve) => {
    resolveRoot = resolve;
  });

  // ---------- layer 1: OTel export of the SDK's spans ----------
  let provider: NodeTracerProvider | null = null;
  safe(() => {
    const seen = new SeenSpanIds();
    const exporter = new OTLPTraceExporter({
      url: BRAINTRUST_OTLP_TRACES_URL,
      headers: { Authorization: `Bearer ${apiKey}`, 'x-bt-parent': `project_name:${opts.project}` },
    });
    const fanout = new telemetry.FanoutSpanProcessor();
    const p = new NodeTracerProvider({
      spanProcessors: [seen, new BatchSpanProcessor(new CallTraceExporter(exporter, seen, rootReady)), fanout],
    });
    if (!globalRegistered) {
      // Global OTel API registration can happen once per process; the SDK's own tracer is
      // switched by setTracerProvider below either way.
      p.register();
      globalRegistered = true;
    }
    telemetry.setTracerProvider(p, {
      metadata: opts.metadata,
      registerSpanProcessor: (proc) => fanout.add(proc),
    });
    provider = p;
  }, 'tracing: OTel provider setup failed, continuing with manual spans only');

  // ---------- layer 2: manual Braintrust spans ----------
  const logger: Logger<true> | undefined = safe(
    () => initLogger({ projectName: opts.project, apiKey, asyncFlush: true, setCurrent: false }),
    'tracing: Braintrust logger init failed',
  );

  let root: Span | null = null;
  let rootEnded = false;

  const handle: TracingHandle = {
    get traceId() {
      return root?.rootSpanId ?? null;
    },

    startCall(sc) {
      if (!logger || root) return;
      safe(() => {
        const span = logger.startSpan({
          name: 'call',
          type: 'task',
          event: {
            input: { identitySource: sc.identity.source, roomName: sc.roomName },
            metadata: { callId: sc.callId, familyBound: Boolean(sc.familyId), ...opts.metadata },
          },
        });
        root = span;
        if (HEX32.test(span.rootSpanId) && HEX16.test(span.spanId)) {
          resolveRoot({ traceId: span.rootSpanId, spanId: span.spanId });
        } else {
          warn(new Error('ids are not OTel-shaped'), 'tracing: SDK spans keep their own trace');
        }
      }, 'tracing: root span start failed');
      resolveRoot(null); // no-op when already resolved
    },

    attach(session) {
      safe(() => {
        session.on(AgentSessionEventTypes.FunctionToolsExecuted, (ev) => {
          const parent = root;
          if (!parent || rootEnded) return;
          safe(() => {
            ev.functionCalls.forEach((call, i) => {
              const output = ev.functionCallOutputs[i];
              const endedAt = output?.createdAt ?? ev.createdAt;
              const durationMs = Math.max(0, endedAt - call.createdAt);
              const span = parent.startSpan({
                name: `tool:${call.name}`,
                type: 'tool',
                startTime: call.createdAt / 1000,
                event: {
                  input: parseArgs(call.args),
                  output: output?.output ?? null,
                  metadata: { tool: call.name, callId: call.callId, isError: output?.isError ?? null, durationMs },
                  metrics: { durationMs },
                },
              });
              span.end({ endTime: endedAt / 1000 });
            });
          }, 'tracing: tool span failed');
        });
      }, 'tracing: attach failed');
    },

    finish(sc, result) {
      const span = root;
      if (!span || rootEnded) return;
      safe(() => {
        span.log({
          output: {
            summary: result.summary,
            outcome: result.outcome,
            bookingIds: [...sc.bookingIds],
            callbackIds: [...sc.callbackIds],
          },
          metadata: { callId: sc.callId, toolCalls: sc.toolLog.length },
        });
        span.end();
        rootEnded = true;
      }, 'tracing: finish failed');
    },

    async shutdown() {
      safe(() => {
        if (root && !rootEnded) {
          root.end();
          rootEnded = true;
        }
      }, 'tracing: ending the root span failed');
      // Unblock any OTLP export still waiting for a call span that never started.
      resolveRoot(null);

      const work = (async () => {
        // Braintrust first: the OTLP spans name the root span as their parent.
        try {
          if (logger) await logger.flush();
        } catch (err) {
          warn(err, 'tracing: Braintrust flush failed');
        }
        try {
          const p = provider as NodeTracerProvider | null;
          // forceFlush, not shutdown: this runs inside the framework's job_shutdown span, which
          // ends later, together with job_entrypoint. The framework then calls forceFlush on the
          // current provider (flushJobTraces), which exports those last spans. A shutdown here
          // would also stop LiveKit Cloud's processor, which sits in the same fanout.
          if (p) await p.forceFlush();
        } catch (err) {
          warn(err, 'tracing: OTel flush failed');
        }
      })();
      const finished = await Promise.race([work.then(() => true), delay(SHUTDOWN_BUDGET_MS)]);
      if (!finished) warn(new Error(`timed out after ${SHUTDOWN_BUDGET_MS} ms`), 'tracing: shutdown did not finish');
    },
  };
  return handle;
}
