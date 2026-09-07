import { useEffect, useRef, useState } from "react";
import type { WorkTaskCursor, WorkTaskPage } from "../../lib/work/workTypes";
export function useWorkFeed<T extends { id: string }>(
  identity: string,
  load: (cursor: WorkTaskCursor | null) => Promise<WorkTaskPage<T>>,
  enabled = true,
  revision = 0,
) {
  const reader = useRef(load);
  reader.current = load;
  const epoch = useRef(0),
    busy = useRef(false),
    current = useRef(identity);
  current.current = identity;
  const [state, setState] = useState<{
    identity: string;
    items: T[];
    cursor: WorkTaskCursor | null;
    loading: boolean;
    error: unknown;
  }>({ identity, items: [], cursor: null, loading: false, error: null });
  const latest = useRef(state);
  latest.current = state;
  async function fetch(append = false) {
    if (!enabled || (append && busy.current)) return;
    const e = ++epoch.current,
      key = identity,
      previous = latest.current;
    busy.current = true;
    setState({
      identity: key,
      items: append ? previous.items : [],
      cursor: append ? previous.cursor : null,
      loading: true,
      error: null,
    });
    try {
      const p = await reader.current(append ? previous.cursor : null);
      if (e !== epoch.current || current.current !== key) return;
      setState({
        identity: key,
        items: append
          ? [
              ...new Map(
                [...previous.items, ...p.items].map((x) => [x.id, x]),
              ).values(),
            ]
          : p.items,
        cursor: p.nextCursor,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (e === epoch.current && current.current === key)
        setState((s) => ({ ...s, loading: false, error }));
    } finally {
      if (e === epoch.current) busy.current = false;
    }
  }
  useEffect(() => {
    void fetch();
    return () => {
      epoch.current++;
      busy.current = false;
    };
  }, [identity, enabled, revision]);
  return {
    ...(state.identity === identity
      ? state
      : { identity, items: [], cursor: null, loading: true, error: null }),
    more: () => fetch(true),
    reload: () => fetch(),
  };
}
