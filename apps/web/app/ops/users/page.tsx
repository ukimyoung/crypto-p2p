'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { USER_STATUS } from '@/lib/messages';
import { KYC_LEVEL, sumsubResult } from '@/lib/ops-labels';
import type { UserRow } from '@/lib/types';
import { Pager, SortHead, toQuery, useQueryState } from '../Grid';

const DEFAULTS = { q: '', status: '', kycLevel: '', from: '', to: '', sort: 'created_at', dir: 'desc', page: '1', pageSize: '50' };

/** A date input (YYYY-MM-DD) as the start of that day in Korea time. */
const kstDay = (d: string, plusDays = 0) =>
  d ? new Date(new Date(`${d}T00:00:00+09:00`).getTime() + plusDays * 86_400_000).toISOString() : '';

export default function OpsUsersPage() {
  const router = useRouter();
  const [state, update, ready] = useQueryState(DEFAULTS);
  const [draft, setDraft] = useState(DEFAULTS);
  const [data, setData] = useState<{ users: UserRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    setDraft(state);
    setError(null);
    const query = toQuery({ ...state, from: kstDay(state.from), to: kstDay(state.to, 1) });
    api<{ users: UserRow[]; total: number }>(`ops/users?${query}`)
      .then(setData)
      .catch((err) => setError(messageOf(err)));
  }, [state, ready]);

  function apply(e: FormEvent) {
    e.preventDefault();
    update({ q: draft.q, status: draft.status, kycLevel: draft.kycLevel, from: draft.from, to: draft.to, page: '1' });
  }

  return (
    <>
      <h1>회원</h1>
      <form className="card filters" onSubmit={apply}>
        <div style={{ gridColumn: 'span 2' }}>
          <label htmlFor="q">검색 (이메일 일부, 전화, 실명, 회원 ID)</label>
          <input id="q" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </div>
        <div>
          <label htmlFor="status">계정 상태</label>
          <select id="status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(USER_STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="kyc">KYC 등급</label>
          <select id="kyc" value={draft.kycLevel} onChange={(e) => setDraft({ ...draft, kycLevel: e.target.value })}>
            <option value="">전체</option>
            {[0, 1].map((n) => (
              <option key={n} value={n}>
                {KYC_LEVEL[n]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="from">가입일부터</label>
          <input id="from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </div>
        <div>
          <label htmlFor="to">가입일까지</label>
          <input id="to" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </div>
        <div>
          <button>적용</button>{' '}
          <button type="button" className="secondary" onClick={() => update({ ...DEFAULTS })}>
            초기화
          </button>
        </div>
      </form>
      <ErrorText error={error} />
      <section className="card">
        {data === null && !error && <p className="muted">불러오는 중…</p>}
        {data?.users.length === 0 && <p className="muted">해당하는 회원이 없습니다.</p>}
        {data && data.users.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {(
                    [
                      ['가입일', 'created_at'],
                      ['이메일', 'email'],
                    ] as const
                  ).map(([label, column]) => (
                    <SortHead
                      key={column}
                      label={label}
                      column={column}
                      sort={state.sort}
                      dir={state.dir}
                      onSort={(sort, dir) => update({ sort, dir, page: '1' })}
                    />
                  ))}
                  <th>전화</th>
                  <th>실명</th>
                  <SortHead label="KYC" column="kyc_level" sort={state.sort} dir={state.dir} onSort={(sort, dir) => update({ sort, dir, page: '1' })} />
                  <th>Sumsub</th>
                  <SortHead label="상태" column="status" sort={state.sort} dir={state.dir} onSort={(sort, dir) => update({ sort, dir, page: '1' })} />
                  <SortHead
                    label="진행 중 주문"
                    column="open_orders"
                    sort={state.sort}
                    dir={state.dir}
                    onSort={(sort, dir) => update({ sort, dir, page: '1' })}
                  />
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className="clickable" onClick={() => router.push(`/ops/users/${u.id}`)}>
                    <td>{new Date(u.createdAt).toLocaleDateString('ko-KR')}</td>
                    <td>{u.email ?? u.id.slice(0, 8)}</td>
                    <td>{u.phone ?? '-'}</td>
                    <td>{u.legalName ?? '-'}</td>
                    <td>{KYC_LEVEL[u.kycLevel] ?? u.kycLevel}</td>
                    <td>{sumsubResult(u.sumsubStatus, u.sumsubAnswer, u.sumsubRejectType)}</td>
                    <td>{USER_STATUS[u.status]}</td>
                    <td>{u.openOrders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <Pager
            page={Number(state.page)}
            pageSize={Number(state.pageSize)}
            total={data.total}
            onChange={(page, pageSize) => update({ page: String(page), pageSize: String(pageSize) })}
          />
        )}
      </section>
    </>
  );
}
