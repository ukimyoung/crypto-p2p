'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Order } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatUnits } from '@/lib/units';

interface Row {
  order: Order;
}

export default function OpsDisputesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    void api<{ disputes: Row[] }>('ops/disputes').then((r) => setRows(r.disputes));
  }, []);

  return (
    <>
      <h1>분쟁</h1>
      <section className="card">
        {rows === null && <p className="muted">불러오는 중…</p>}
        {rows?.length === 0 && <p className="muted">진행 중인 분쟁이 없습니다.</p>}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>주문</th>
                  <th>수량</th>
                  <th>금액</th>
                  <th>이체 완료 표시</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ order }) => (
                  <tr key={order.id}>
                    <td>
                      <Link href={`/ops/disputes/${order.id}`}>{order.id.slice(0, 8)}</Link>
                    </td>
                    <td>
                      {formatUnits(order.amount, ASSETS[order.asset as AssetCode]?.decimals ?? 0)} {order.asset}
                    </td>
                    <td>{formatKrw(order.fiatAmountMinor)}</td>
                    <td>{order.paidAt ? new Date(order.paidAt).toLocaleString('ko-KR') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
