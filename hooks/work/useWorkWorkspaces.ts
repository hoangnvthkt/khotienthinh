import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkWorkspaceService,
  WorkspaceSort,
} from "../../lib/work/workWorkspaceService";
import type {
  WorkspaceCursor,
  WorkspaceKind,
  WorkspaceSummary,
} from "../../lib/work/workWorkspaceTypes";
import { mergeWorkspacePage } from "../../pages/work/workspacePresentation";

export function useWorkWorkspaces(
  service: WorkWorkspaceService,
  actorId: string,
  search: string,
  kind: WorkspaceKind | null,
  pinnedOnly: boolean | null = null,
  sort: WorkspaceSort = "updated",
) {
  const identity = JSON.stringify([actorId, search, kind, pinnedOnly, sort]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const generation = useRef(0);
  const busy = useRef(false);
  const [state, setState] = useState<{
    identity: string;
    items: WorkspaceSummary[];
    cursor: WorkspaceCursor | null;
    loading: boolean;
    error: unknown;
  }>({ identity, items: [], cursor: null, loading: true, error: null });
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(async (append = false) => {
    if (append && busy.current) return;
    const requestIdentity = identity;
    const version = ++generation.current;
    const previous = stateRef.current;
    busy.current = true;
    setState((old) => ({
      identity,
      items: append && old.identity === identity ? old.items : [],
      cursor: append && old.identity === identity ? old.cursor : null,
      loading: true,
      error: null,
    }));
    try {
      const page = await service.list(
        search,
        kind,
        append && previous.identity === identity ? previous.cursor : null,
        pinnedOnly,
        sort,
      );
      if (version !== generation.current || identityRef.current !== requestIdentity) return;
      setState({
        identity,
        items: append ? mergeWorkspacePage(previous.items, page.items) : page.items,
        cursor: page.nextCursor,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (version !== generation.current || identityRef.current !== requestIdentity) return;
      setState({
        identity,
        items: append && previous.identity === identity ? previous.items : [],
        cursor: append && previous.identity === identity ? previous.cursor : null,
        loading: false,
        error,
      });
    } finally {
      if (version === generation.current) busy.current = false;
    }
  }, [service, identity, search, kind, pinnedOnly, sort]);

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      busy.current = false;
    };
  }, [load]);

  const visible = state.identity === identity
    ? state
    : { identity, items: [], cursor: null, loading: true, error: null };

  const setPinned = async (workspaceId: string, pinned: boolean) => {
    const before = stateRef.current;
    setState((old) => ({
      ...old,
      items: old.items.map((item) => item.id === workspaceId ? { ...item, pinned } : item),
    }));
    try {
      await service.setPreference(workspaceId, pinned, false);
    } catch (error) {
      setState((old) => old.identity === before.identity ? { ...before, error } : old);
      throw error;
    }
  };

  return {
    ...visible,
    refresh: () => load(false),
    loadMore: () => load(true),
    setPinned,
  };
}
