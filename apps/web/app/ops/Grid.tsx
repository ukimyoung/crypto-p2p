'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Filter, sort and page state kept in the URL query (USR-2), so a refresh or the
 * back button lands on the same view. Values are strings; defaults are left out of the URL.
 * `defaults` must not change between renders.
 */
export function useQueryState<T extends Record<string, string>>(
  defaults: T,
): [T, (next: Partial<T>) => void, boolean] {
  const read = useCallback((): T => {
    if (typeof window === 'undefined') return defaults;
    const params = new URLSearchParams(window.location.search);
    return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, params.get(k) ?? v])) as T;
  }, []);
  const [state, setState] = useState<T>(defaults);
  // False until the URL has been read, so pages do not fetch the default view first.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(read());
    setReady(true);
    const onPop = () => setState(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [read]);

  const current = useRef(state);
  current.current = state;

  const update = useCallback((next: Partial<T>) => {
    const merged = { ...current.current, ...next } as T;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v && v !== defaults[k]) params.set(k, v);
    const qs = params.toString();
    window.history.pushState(null, '', qs ? `?${qs}` : window.location.pathname);
    setState(merged);
  }, []);
  return [state, update, ready];
}

/** Turns a query state into an API query string. */
export function toQuery(state: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v) params.set(k, v);
  return params.toString();
}

/** A column head that sorts by `column`; pressing it again flips the direction. */
export function SortHead({
  label,
  column,
  sort,
  dir,
  onSort,
}: {
  label: string;
  column: string;
  sort: string;
  dir: string;
  onSort: (sort: string, dir: string) => void;
}) {
  const active = sort === column;
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        className="link-button sort-head"
        onClick={() => onSort(column, active && dir === 'desc' ? 'asc' : 'desc')}
      >
        {label} {active ? (dir === 'asc' ? '▲' : '▼') : ''}
      </button>
    </th>
  );
}

/** Page numbers with the total count and a page-size picker. */
export function Pager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => from + i);
  return (
    <div className="pager">
      <span className="muted small-text">총 {total.toLocaleString('ko-KR')}건</span>
      <button type="button" className="small" disabled={page <= 1} onClick={() => onChange(page - 1, pageSize)}>
        이전
      </button>
      {numbers.map((n) => (
        <button
          key={n}
          type="button"
          className={`small ${n === page ? '' : 'secondary'}`}
          aria-current={n === page ? 'page' : undefined}
          onClick={() => onChange(n, pageSize)}
        >
          {n}
        </button>
      ))}
      <button type="button" className="small" disabled={page >= pages} onClick={() => onChange(page + 1, pageSize)}>
        다음
      </button>
      <select
        aria-label="페이지당 건수"
        value={pageSize}
        style={{ width: 'auto' }}
        onChange={(e) => onChange(1, Number(e.target.value))}
      >
        {[20, 50, 100].map((n) => (
          <option key={n} value={n}>
            {n}건씩
          </option>
        ))}
      </select>
    </div>
  );
}
