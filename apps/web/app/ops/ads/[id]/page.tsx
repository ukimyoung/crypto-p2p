'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { ORDER_STATUS } from '@/lib/messages';
import { AD_STATUS } from '@/lib/ops-labels';
import type { OpsAd, OpsOrder } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatRate, formatUnits } from '@/lib/units';

export default function OpsAdPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ ad: OpsAd & { feeRateBp: number; finalPriceMinor: string }; orders: OpsOrder[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api(`ops/ads/${id}`));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function takeDown(status: 'offline' | 'closed') {
    const reason = window.prompt(
      status === 'closed'
        ? '광고를 강제 종료합니다. 사유를 적어 주세요. (광고주에게는 사유가 가지 않습니다)'
        : '광고를 비노출로 바꿉니다. 사유를 적어 주세요. (광고주에게는 사유가 가지 않습니다)',
    );
    if (!reason?.trim()) return;
    setError(null);
    try {
      await api(`ops/ads/${id}/status`, { body: { status, reason } });
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (!data) return <p className="muted">불러오는 중…</p>;
  const { ad, orders } = data;
  const decimals = ASSETS[ad.asset as AssetCode]?.decimals ?? 0;
  const coins = (v: string) => `${formatUnits(v, decimals)} ${ad.asset}`;

  return (
    <>
      <p className="small-text">
        <Link href="/ops/ads">← 광고</Link>
      </p>
      <h1>
        {ad.asset}/{ad.fiat} {ad.side === 'sell' ? '팔기' : '사기'} 광고{' '}
        <span className={`badge ${ad.status === 'online' ? 'completed' : 'cancelled'}`}>{AD_STATUS[ad.status]}</span>
      </h1>
      <ErrorText error={error} />
      <section className="card">
        <dl className="kv">
          <dt>광고주</dt>
          <dd>
            <Link href={`/ops/users/${ad.makerId}`}>{ad.makerEmail}</Link>
          </dd>
          <dt>입력 가격</dt>
          <dd>{formatKrw(ad.priceMinor)}</dd>
          <dt>최종 광고 가격</dt>
          <dd>
            {formatKrw(ad.finalPriceMinor)} <span className="muted small-text">(등록 시 요율 {formatRate(ad.feeRateBp)})</span>
          </dd>
          <dt>수량</dt>
          <dd>
            남은 {coins(ad.remainingAmount)} / 전체 {coins(ad.totalAmount)}
          </dd>
          <dt>주문 한도</dt>
          <dd>
            {formatKrw(ad.minOrderFiatMinor)} ~ {formatKrw(ad.maxOrderFiatMinor)}
          </dd>
          <dt>결제 기한</dt>
          <dd>{ad.paymentWindowMinutes}분</dd>
          <dt>최소 KYC</dt>
          <dd>{ad.minTakerKycLevel}단계</dd>
          <dt>등록</dt>
          <dd>{new Date(ad.createdAt).toLocaleString('ko-KR')}</dd>
        </dl>
        {ad.status !== 'closed' && (
          <p>
            {ad.status === 'online' && (
              <>
                <button type="button" className="small secondary" onClick={() => takeDown('offline')}>
                  비노출
                </button>{' '}
              </>
            )}
            <button type="button" className="small danger" onClick={() => takeDown('closed')}>
              강제 종료
            </button>{' '}
            <span className="muted small-text">진행 중인 주문은 그대로 두고 새 주문만 막습니다. 광고주에게 알림이 갑니다.</span>
          </p>
        )}
      </section>
      <section className="card">
        <h2>이 광고로 생긴 주문 ({orders.length})</h2>
        {orders.length === 0 ? (
          <p className="muted">주문이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>주문 번호</th>
                  <th>시각</th>
                  <th>구매자</th>
                  <th>판매자</th>
                  <th>수량</th>
                  <th>금액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/ops/orders/${o.id}`}>{o.orderNumber}</Link>
                    </td>
                    <td>{new Date(o.createdAt).toLocaleString('ko-KR')}</td>
                    <td>{o.buyerEmail}</td>
                    <td>{o.sellerEmail}</td>
                    <td>{coins(o.amount)}</td>
                    <td>{formatKrw(o.fiatAmountMinor)}</td>
                    <td>
                      <Link href={`/ops/orders/${o.id}`}>{ORDER_STATUS[o.status]}</Link>
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
