'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ORDER_STATUS } from '@/lib/messages';
import type { OpsOrder } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatRate, formatUnits } from '@/lib/units';

interface Detail {
  order: OpsOrder & { feeAmount: string; paymentDeadline: string; feeInvoiceId: string | null };
  history: { id: string; actorType: string; actorId: string | null; action: string; status: string | null; createdAt: string }[];
  messages: { id: string; senderId: string; body: string; createdAt: string }[];
  ledger: { key: string; kind: string; account: string; asset: string; userEmail: string | null; amount: string; createdAt: string }[];
  operatorNames: Record<string, string>;
}

const ACTIONS: Record<string, string> = {
  'order.create': '주문 생성',
  'order.mark_paid': '이체 완료 표시',
  'order.release': '코인 전달',
  'order.cancel': '구매자 취소',
  'order.expire': '결제 기한 만료',
  'order.escalate': '운영 검토 요청',
  'order.resolve_release': '운영자 결정: 구매자에게 전달',
  'order.resolve_refund': '운영자 결정: 판매자에게 반환',
};
const ACCOUNTS: Record<string, string> = {
  available: '가용',
  escrow: '에스크로',
  withdrawal_pending: '출금 대기',
  custody: '커스터디',
  fee_revenue: '수수료 수익',
};
const when = (d: string) => new Date(d).toLocaleString('ko-KR');

export default function OpsOrderPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);

  useEffect(() => {
    void api<Detail>(`ops/orders/${id}`).then(setData);
  }, [id]);

  if (!data) return <p className="muted">불러오는 중…</p>;
  const { order: o, history, messages, ledger, operatorNames } = data;
  const decimals = ASSETS[o.asset as AssetCode]?.decimals ?? 0;
  const coins = (v: string) => `${formatUnits(v, decimals)} ${o.asset}`;
  const who = (h: Detail['history'][number]) => {
    if (h.actorType === 'system') return '시스템';
    if (h.actorType === 'operator') return `운영자 ${operatorNames[h.actorId ?? ''] ?? ''}`;
    return h.actorId === o.buyerId ? '구매자' : h.actorId === o.sellerId ? '판매자' : '이용자';
  };

  return (
    <>
      <p className="small-text">
        <Link href="/ops/orders">← 주문</Link>
      </p>
      <h1>
        주문 {o.orderNumber} <span className={`badge ${o.status}`}>{ORDER_STATUS[o.status]}</span>
      </h1>
      {o.status === 'under_review' && (
        <p className="notice">
          운영 검토 중인 주문입니다. <Link href={`/ops/disputes/${o.id}`}>분쟁 화면에서 결정하기</Link>
        </p>
      )}
      <div className="grid2">
        <section className="card">
          <dl className="kv">
            <dt>구매자</dt>
            <dd>
              <Link href={`/ops/users/${o.buyerId}`}>{o.buyerEmail ?? o.buyerId}</Link>
              {o.makerId === o.buyerId && ' (광고주)'}
            </dd>
            <dt>판매자</dt>
            <dd>
              <Link href={`/ops/users/${o.sellerId}`}>{o.sellerEmail ?? o.sellerId}</Link>
              {o.makerId === o.sellerId && ' (광고주)'}
            </dd>
            <dt>광고</dt>
            <dd>
              <Link href={`/ops/ads/${o.adId}`}>보기</Link>
            </dd>
            <dt>수량 (에스크로)</dt>
            <dd>
              {coins(o.amount)} ({coins(o.escrowAmount)})
            </dd>
            <dt>입력 가격</dt>
            <dd>{formatKrw(o.basePriceMinor)}</dd>
            <dt>최종 가격</dt>
            <dd>{formatKrw(o.priceMinor)}</dd>
            <dt>이체 금액</dt>
            <dd className="price">{formatKrw(o.fiatAmountMinor)}</dd>
            <dt>광고 수수료</dt>
            <dd>
              {formatKrw(o.feeFiatMinor)} ({formatRate(o.feeRateBp)})
              {o.feeInvoiceId && (
                <>
                  {' '}
                  <Link href={`/ops/fees/${o.feeInvoiceId}`}>청구서</Link>
                </>
              )}
            </dd>
            {BigInt(o.feeAmount) > 0n && (
              <>
                <dt>코인 수수료 (이전 방식)</dt>
                <dd>{coins(o.feeAmount)}</dd>
              </>
            )}
            <dt>결제 기한</dt>
            <dd>{when(o.paymentDeadline)}</dd>
            <dt>주문 번호</dt>
            <dd>{o.orderNumber}</dd>
            <dt>내부 ID</dt>
            <dd className="muted small-text">{o.id}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>상태 이력</h2>
          <ol>
            {history.map((h) => (
              <li key={h.id}>
                {when(h.createdAt)} · {ACTIONS[h.action] ?? h.action} · <span className="muted">{who(h)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <section className="card">
        <h2>원장 분개</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>분개</th>
                <th>계정</th>
                <th>회원</th>
                <th>금액</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={i}>
                  <td>{when(l.createdAt)}</td>
                  <td className="muted small-text">{l.key}</td>
                  <td>{ACCOUNTS[l.account] ?? l.account}</td>
                  <td>{l.userEmail ?? '-'}</td>
                  <td>
                    {l.amount.startsWith('-') ? '-' : '+'}
                    {formatUnits(l.amount.replace('-', ''), decimals)} {l.asset}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>채팅 (읽기 전용)</h2>
        {messages.length === 0 ? (
          <p className="muted">메시지가 없습니다.</p>
        ) : (
          <ul className="chat-log">
            {messages.map((m) => (
              <li key={m.id}>
                <strong>{m.senderId === o.buyerId ? '구매자' : m.senderId === o.sellerId ? '판매자' : '?'}</strong>{' '}
                <span className="muted small-text">{when(m.createdAt)}</span>
                <div>{m.body}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
