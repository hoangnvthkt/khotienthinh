// Tìm ngay khi gõ trong ô hỏi Trợ lý: cùng cách phân tích câu (đồng nghĩa, lỗi gõ), cùng RPC và cùng thước đo xếp hạng với ô Tìm kiếm.
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchRecords } from '../../lib/search/globalSearchService';
import { HIT_LIMIT, INSTANT_DEBOUNCE_MS, entityTerms, instantKinds, rankRecordHits, type RankedHit } from '../../lib/search/instantSearch';
import { parseQuery } from '../../lib/search/searchEngine';
import type { ServerRecord } from '../../lib/search/searchTypes';

export type InstantSearchFn = typeof searchRecords;

export const useInstantSearch = (query: string, opts: { enabled: boolean; canOpen: (route: string) => boolean; search?: InstantSearchFn }) => {
  const { enabled, canOpen, search = searchRecords } = opts;
  const text = enabled ? query.trim() : '';
  const [state, setState] = useState<{ text: string; records: ServerRecord[]; loading: boolean }>({ text: '', records: [], loading: false });
  const generation = useRef(0);
  const kinds = useMemo(() => instantKinds(canOpen), [canOpen]);

  useEffect(() => {
    if (text.length < 2 || !kinds.length) { setState({ text: '', records: [], loading: false }); return; }
    const gen = ++generation.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parsed = parseQuery(text);
      const terms = entityTerms(text, parsed);
      if (!terms.length) { setState({ text, records: [], loading: false }); return; }
      // Câu có gợi ý loại ("nhân viên", "đơn hàng") → chỉ tìm loại đó khi người này mở được.
      const hinted = kinds.filter(k => parsed.kindHints.includes(k));
      setState(s => ({ ...s, loading: true }));
      search(terms, hinted.length ? hinted : kinds, HIT_LIMIT + 3, controller.signal)
        .then(result => { if (generation.current === gen) setState({ text, records: result.records, loading: false }); })
        .catch(() => { if (generation.current === gen) setState({ text, records: [], loading: false }); });
    }, INSTANT_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [text, kinds, search]);

  const hits = useMemo<RankedHit[]>(() => {
    if (text.length < 2) return [];
    const parsed = parseQuery(text);
    const ranked = rankRecordHits(state.records, parsed);
    // Đang gõ câu mới mà máy chủ chưa trả: chỉ giữ hồ sơ cũ còn khớp câu mới.
    return state.text === text ? ranked : ranked.filter(h => h.matchedAll);
  }, [text, state.records, state.text]);

  return { hits, loading: state.loading && text.length >= 2, text };
};
