'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { AD_STATUS } from '@/lib/ops-labels';
import type { OpsAd } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatUnits } from '@/lib/units';
import { Pager, SortHead, toQuery, useQueryState } from '../Grid';

const DEFAULTS = { asset: '', side: '', status: '', makerId: '', sort: 'created_at', dir: 'desc', page: '1', pageSize: '50' };

export default function OpsAdsPage() {
  const router = useRouter();
  const [state, update, ready] = useQueryState(DEFAULTS);
  const [data, setData] = useState<{ ads: OpsAd[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    setError(null);
    api<{ ads: OpsAd[]; total: number }>(`ops/ads?${toQuery(state)}`)
      .then(setData)
      .catch((err) => setError(messageOf(err)));
  }, [state, ready]);

  const sortHead = (label: string, column: string) => (
    <SortHead label={label} column={column} sort={state.sort} dir={state.dir} onSort={(sort, dir) => update({ sort, dir, page: '1' })} />
  );

  return (
    <>
      <h1>광고</h1>
      <div className="card filters">
        <div>
          <label htmlFor="asset">코인</label>
          <select id="asset" value={state.asset} onChange={(e) => update({ asset: e.target.value, page: '1' })}>
            <option value="">전체</option>
            {Object.keys(ASSETS).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="side">종류</label>
          <select id="side" value={state.side} onChange={(e) => update({ side: e.target.value, page: '1' })}>
            <option value="">전체</option>
            <option value="sell">팔기 광고</option>
            <option value="buy">사기 광고</option>
          </select>
        </div>
        <div>
          <label htmlFor="status">상태</label>
          <select id="status" value={state.status} onChange={(e) => update({ status: e.target.value, page: '1' })}>
            <option value="">전체</option>
            {Object.entries(AD_STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {state.makerId && (
          <div>
            <span className="muted small-text">광고주 {state.makerId.slice(0, 8)}만 보는 중</span>{' '}
            <button type="button" className="small secondary" onClick={() => update({ makerId: '', page: '1' })}>
              해제
            </button>
          </div>
        )}
      </div>
      <ErrorText error={error} />
      <section className="card">
        {data === null && !error && <p className="muted">불러오는 중…</p>}
        {data?.ads.length === 0 && <p className="muted">해당하는 광고가 없습니다.</p>}
        {data && data.ads.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {sortHead('등록일', 'created_at')}
                  <th>광고주</th>
                  <th>마켓</th>
                  <th>종류</th>
                  {sortHead('입력 가격', 'price_minor')}
                  {sortHead('남은 수량', 'remaining_amount')}
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {data.ads.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => router.push(`/ops/ads/${a.id}`)}>
                    <td>{new Date(a.createdAt).toLocaleString('ko-KR')}</td>
                    <td>{a.makerEmail}</td>
                    <td>
                      {a.asset}/{a.fiat}
                    </td>
                    <td>{a.side === 'sell' ? '팔기' : '사기'}</td>
                    <td>{formatKrw(a.priceMinor)}</td>
                    <td>
                      {formatUnits(a.remainingAmount, ASSETS[a.asset as AssetCode]?.decimals ?? 0)} {a.asset}
                    </td>
                    <td>{AD_STATUS[a.status]}</td>
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
