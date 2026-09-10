import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type {
  WorkTaskCursor,
  WorkTaskFilters,
  WorkTaskSummary,
  WorkTaskView,
} from "../../lib/work/workTypes";
import type { WorkspaceCursor } from "../../lib/work/workWorkspaceTypes";
export function useWorkTasks(
  service: WorkTaskService,
  actorId: string,
  view: WorkTaskView,
  filters: WorkTaskFilters,
  enabled = true,
  workspaceId?: string,
  accessRevision = 0,
) {
  // Access revisions trigger a fresh authorization check, not a different list.
  // Keep its rows while pending; a denied response still clears them below.
  const identity = JSON.stringify([
    actorId,
    workspaceId ?? null,
    view,
    filters,
  ]);
  const generation = useRef(0);
  const busy = useRef(false);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [state, setState] = useState<{
    identity: string;
    items: WorkTaskSummary[];
    cursor: WorkTaskCursor | null;
    loading: boolean;
    error: unknown;
  }>({ identity, items: [], cursor: null, loading: true, error: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  const load = useCallback(
    async (append = false) => {
      if (!enabled) {
        generation.current++;
        busy.current = false;
        setState({
          identity,
          items: [],
          cursor: null,
          loading: false,
          error: null,
        });
        return;
      }
      if (append && busy.current) return;
      const version = ++generation.current;
      const requestIdentity = identity;
      busy.current = true;
      const previous = stateRef.current;
      setState((s) => ({
        ...s,
        identity,
        items: s.identity === identity ? s.items : [],
        cursor: s.identity === identity ? s.cursor : null,
        loading: true,
        error: null,
      }));
      try {
        let page;
        if (workspaceId !== undefined) {
          const workspaceTasks = service.workspaceTasks;
          if (!workspaceTasks)
            throw new Error("Workspace task listing is unavailable.");
          page = await workspaceTasks(
            workspaceId,
            filters,
            (append ? previous.cursor : null) as WorkspaceCursor | null,
          );
        } else {
          page = await service.list(
            view,
            filters,
            append ? previous.cursor : null,
          );
        }
        if (
          version !== generation.current ||
          identityRef.current !== requestIdentity
        )
          return;
        setState({
          identity,
          items: append
            ? [
                ...new Map(
                  [...previous.items, ...page.items].map((x) => [x.id, x]),
                ).values(),
              ]
            : page.items,
          cursor: page.nextCursor,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (
          version === generation.current &&
          identityRef.current === requestIdentity
        )
          setState({
            identity,
            items: append ? previous.items : [],
            cursor: append ? previous.cursor : null,
            loading: false,
            error,
          });
      } finally {
        if (version === generation.current) busy.current = false;
      }
    },
    [service, identity, enabled, accessRevision],
  ); // identity includes the complete immutable query inputs.
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      busy.current = false;
    };
  }, [load]);
  const visible = !enabled
    ? { identity, items: [], cursor: null, loading: false, error: null }
    : state.identity === identity
      ? state
      : { identity, items: [], cursor: null, loading: true, error: null };
  return { ...visible, refresh: () => load(), loadMore: () => load(true) };
}
