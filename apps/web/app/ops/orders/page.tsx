'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { ORDER_STATUS } from '@/lib/messages';
import type { OpsOrder } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatUnits } from '@/lib/units';
import { Pager, toQuery, useQueryState } from '../Grid';

const DEFAULTS = { status: '', asset: '', orderNumber: '', userId: '', from: '', to: '', page: '1', pageSize: '50' };
const kstDay = (d: string, plusDays = 0) =>
  d ? new Date(new Date(`${d}T00:00:00+09:00`).getTime() + plusDays * 86_400_000).toISOString() : '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function OpsOrdersPage() {
  const router = useRouter();
  const [state, update, ready] = useQueryState(DEFAULTS);
  const [userId, setUserId] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [data, setData] = useState<{ orders: OpsOrder[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    setUserId(state.userId);
    setOrderNumber(state.orderNumber);
    setError(null);
    api<{ orders: OpsOrder[]; total: number }>(
      `ops/orders?${toQuery({ ...state, from: kstDay(state.from), to: kstDay(state.to, 1) })}`,
    )
      .then(setData)
      .catch((err) => setError(messageOf(err)));
  }, [state, ready]);

  function applyUser(e: FormEvent) {
    e.preventDefault();
    const number = orderNumber.replace(/\D/g, '');
    if (orderNumber.trim() && !/^\d{1,13}$/.test(number)) {
      setError('주문 번호는 숫자로 입력해 주세요. 앞자리(예: 20261026)만 넣으면 그날 주문을 찾습니다.');
      return;
    }
    if (userId && !UUID.test(userId.trim())) {
      setError('당사자는 회원 ID로 찾습니다. 회원 화면에서 ID를 복사해 주세요.');
      return;
    }
    update({ orderNumber: number, userId: userId.trim(), page: '1' });
  }

  return (
    <>
      <h1>주문</h1>
      <form className="card filters" onSubmit={applyUser}>
        <div>
          <label htmlFor="status">상태</label>
          <select id="status" value={state.status} onChange={(e) => update({ status: e.target.value, page: '1' })}>
            <option value="">전체</option>
            {Object.entries(ORDER_STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
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
          <label htmlFor="from">주문일부터</label>
          <input id="from" type="date" value={state.from} onChange={(e) => update({ from: e.target.value, page: '1' })} />
        </div>
        <div>
          <label htmlFor="to">주문일까지</label>
          <input id="to" type="date" value={state.to} onChange={(e) => update({ to: e.target.value, page: '1' })} />
        </div>
        <div>
          <label htmlFor="orderNumber">주문 번호</label>
          <input
            id="orderNumber"
            inputMode="numeric"
            placeholder="202610260001"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
          />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label htmlFor="user">당사자 (회원 ID)</label>
          <div className="row">
            <input id="user" value={userId} onChange={(e) => setUserId(e.target.value)} />
            <button>적용</button>
          </div>
        </div>
      </form>
      <ErrorText error={error} />
      <section className="card">
        {data === null && !error && <p className="muted">불러오는 중…</p>}
        {data?.orders.length === 0 && <p className="muted">해당하는 주문이 없습니다.</p>}
        {data && data.orders.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>주문 번호</th>
                  <th>주문 시각</th>
                  <th>구매자</th>
                  <th>판매자</th>
                  <th>수량</th>
                  <th>금액</th>
                  <th>수수료</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => router.push(`/ops/orders/${o.id}`)}>
                    <td>{o.orderNumber}</td>
                    <td>{new Date(o.createdAt).toLocaleString('ko-KR')}</td>
                    <td>{o.buyerEmail ?? o.buyerId.slice(0, 8)}</td>
                    <td>{o.sellerEmail ?? o.sellerId.slice(0, 8)}</td>
                    <td>
                      {formatUnits(o.amount, ASSETS[o.asset as AssetCode]?.decimals ?? 0)} {o.asset}
                    </td>
                    <td>{formatKrw(o.fiatAmountMinor)}</td>
                    <td>{formatKrw(o.feeFiatMinor)}</td>
                    <td>
                      <span className={`badge ${o.status}`}>{ORDER_STATUS[o.status]}</span>
                    </td>
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
