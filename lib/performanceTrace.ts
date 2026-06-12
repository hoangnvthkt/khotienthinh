type TraceStep = {
  label: string;
  durationMs: number;
  startedAtMs: number;
  endedAtMs: number;
  meta?: Record<string, any>;
};

type ActiveStep = {
  label: string;
  startedAtMs: number;
  meta?: Record<string, any>;
};

export type PerformanceTraceReport = {
  id: string;
  name: string;
  totalMs: number;
  startedAt: string;
  endedAt: string;
  steps: TraceStep[];
  meta?: Record<string, any>;
};

const STORAGE_KEY = 'vioo:performance:last-traces';
const MAX_STORED_TRACES = 20;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const roundMs = (value: number) => Math.round(value * 10) / 10;

const persistTrace = (report: PerformanceTraceReport) => {
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const next = [report, ...(Array.isArray(existing) ? existing : [])].slice(0, MAX_STORED_TRACES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors. Performance traces should never block product flows.
  }
};

export const createPerformanceTrace = (name: string, meta?: Record<string, any>) => {
  const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAtMs = now();
  const startedAt = new Date().toISOString();
  const activeSteps = new Map<string, ActiveStep>();
  const steps: TraceStep[] = [];

  const trace = {
    id,
    name,
    startStep(label: string, stepMeta?: Record<string, any>) {
      activeSteps.set(label, { label, startedAtMs: now(), meta: stepMeta });
    },
    endStep(label: string, stepMeta?: Record<string, any>) {
      const activeStep = activeSteps.get(label);
      if (!activeStep) return;
      activeSteps.delete(label);
      const endedAtMs = now();
      steps.push({
        label,
        durationMs: roundMs(endedAtMs - activeStep.startedAtMs),
        startedAtMs: roundMs(activeStep.startedAtMs - startedAtMs),
        endedAtMs: roundMs(endedAtMs - startedAtMs),
        meta: { ...(activeStep.meta || {}), ...(stepMeta || {}) },
      });
    },
    step<T>(label: string, task: () => PromiseLike<T>, stepMeta?: Record<string, any>): Promise<T> {
      trace.startStep(label, stepMeta);
      return Promise.resolve(task()).finally(() => trace.endStep(label));
    },
    finish(finishMeta?: Record<string, any>): PerformanceTraceReport {
      const endedAtMs = now();
      const report: PerformanceTraceReport = {
        id,
        name,
        totalMs: roundMs(endedAtMs - startedAtMs),
        startedAt,
        endedAt: new Date().toISOString(),
        steps: [...steps].sort((a, b) => a.startedAtMs - b.startedAtMs),
        meta: { ...(meta || {}), ...(finishMeta || {}) },
      };

      persistTrace(report);
      if (typeof console !== 'undefined') {
        console.groupCollapsed(`[Perf] ${name}: ${report.totalMs}ms`);
        console.table(report.steps.map(step => ({
          step: step.label,
          durationMs: step.durationMs,
          startMs: step.startedAtMs,
          endMs: step.endedAtMs,
          ...step.meta,
        })));
        console.log(report);
        console.groupEnd();
      }
      return report;
    },
  };

  return trace;
};

export const getStoredPerformanceTraces = (): PerformanceTraceReport[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const traces = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(traces) ? traces : [];
  } catch {
    return [];
  }
};
