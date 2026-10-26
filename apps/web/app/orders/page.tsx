'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ORDER_STATUS } from '@/lib/messages';
import type { Order } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatUnits } from '@/lib/units';
import { useMe } from '@/lib/use-me';

export default function OrdersPage() {
  const { me } = useMe();
  const { t, locale } = useT();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ orders: Order[] }>('orders')
      .then((res) => setOrders(res.orders))
      .catch((err) => setError(messageOf(err)));
  }, []);

  return (
    <>
      <h1>{t('내 주문')}</h1>
      <section className="card">
        <ErrorText error={error} />
        {orders?.length === 0 && <p className="muted">{t('아직 주문이 없습니다.')}</p>}
        {orders && orders.length > 0 && me && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('주문 번호')}</th>
                  <th>{t('구분')}</th>
                  <th>{t('수량')}</th>
                  <th>{t('금액')}</th>
                  <th>{t('상태')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`}>{o.orderNumber}</Link>
                    </td>
                    <td>{t(o.buyerId === me.id ? '구매' : '판매')}</td>
                    <td>
                      {formatUnits(o.amount, ASSETS[o.asset as AssetCode].decimals)} {o.asset}
                    </td>
                    <td>{formatKrw(o.fiatAmountMinor, locale)}</td>
                    <td>
                      <span className={`badge ${o.status}`}>{t(ORDER_STATUS[o.status] ?? o.status)}</span>
                    </td>
                    <td>
                      <Link href={`/orders/${o.id}`}>{t('보기')}</Link>
                    </td>
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
