'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { INVOICE_STATUS } from '@/lib/messages';
import type { FeeInvoiceDetail } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatRate, formatUnits, kstDate } from '@/lib/units';
import { withStepUp } from '@/lib/use-operator';

/** Now as a datetime-local value in the browser's time zone. */
function localNow(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function OpsInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<FeeInvoiceDetail | null>(null);
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(localNow);
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api<FeeInvoiceDetail>(`ops/fee-invoices/${id}`);
    setDetail(d);
    setAmount((BigInt(d.invoice.totalMinor) - BigInt(d.invoice.paidMinor)).toString());
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function record(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = amount.replaceAll(',', '').trim();
    if (!/^[1-9]\d*$/.test(value)) {
      setError('납부 금액은 1원 이상의 정수로 입력해 주세요.');
      return;
    }
    if (!window.confirm(`${formatKrw(value)} 납부를 기록할까요? 기록은 감사 로그에 남고 되돌릴 수 없습니다.`)) return;
    try {
      const body = { amountMinor: value, paidAt: new Date(paidAt).toISOString(), memo };
      const res = await withStepUp(() => api<FeeInvoiceDetail>(`ops/fee-invoices/${id}/payments`, { body }));
      if (!res) return;
      setMemo('');
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (!detail) return <p className="muted">불러오는 중…</p>;
  const { invoice, orders, payments } = detail;
  const left = BigInt(invoice.totalMinor) - BigInt(invoice.paidMinor);

  return (
    <>
      <p>
        <Link href="/ops/fees">← 수수료 청구</Link>
      </p>
      <h1>
        청구서 <span className={`badge invoice-${invoice.status}`}>{INVOICE_STATUS[invoice.status]}</span>
      </h1>
      <section className="card">
        <dl className="kv">
          <dt>광고주</dt>
          <dd>
            <Link href={`/ops/users/${invoice.makerId}`}>{invoice.makerEmail ?? invoice.makerId}</Link>
          </dd>
          <dt>기간</dt>
          <dd>
            {kstDate(invoice.periodStart)} ~ {kstDate(invoice.periodEnd, true)}
          </dd>
          <dt>청구 금액</dt>
          <dd className="price">{formatKrw(invoice.totalMinor)}</dd>
          <dt>납부한 금액</dt>
          <dd>{formatKrw(invoice.paidMinor)}</dd>
          <dt>남은 금액</dt>
          <dd>{formatKrw(left)}</dd>
          <dt>발행</dt>
          <dd>{new Date(invoice.issuedAt).toLocaleString('ko-KR')}</dd>
          <dt>납부 기한</dt>
          <dd>{kstDate(invoice.dueAt, true)} (이날이 끝날 때까지)</dd>
          <dt>청구서 번호</dt>
          <dd className="muted small-text">{invoice.id}</dd>
        </dl>
      </section>

      {left > 0n && (
        <section className="card">
          <h2>납부 기록</h2>
          <p className="muted small-text">
            광고주의 입금을 은행에서 확인한 뒤 기록해 주세요. 일부만 들어왔으면 들어온 금액만 적으면 남은 금액은
            미납으로 남습니다. 연체된 청구서는 완납해야 광고 숨김이 풀립니다.
          </p>
          <form onSubmit={record} className="settings-form">
            <div className="grid2">
              <div>
                <label htmlFor="pay-amount">납부 금액 (원)</label>
                <input id="pay-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pay-at">입금 확인 일시</label>
                <input id="pay-at" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </div>
            </div>
            <label htmlFor="pay-memo">메모 (입금자명, 은행 등)</label>
            <input id="pay-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <button>납부 기록 (OTP 확인)</button>
            <ErrorText error={error} />
          </form>
        </section>
      )}

      <section className="card">
        <h2>납부 내역</h2>
        {payments.length === 0 ? (
          <p className="muted">아직 납부 기록이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>입금 확인 일시</th>
                  <th>금액</th>
                  <th>메모</th>
                  <th>기록한 사람</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.paidAt).toLocaleString('ko-KR')}</td>
                    <td>{formatKrw(p.amountMinor)}</td>
                    <td>{p.memo || '-'}</td>
                    <td className="muted">{p.operatorEmail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>포함된 주문 ({orders.length}건)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>주문 번호</th>
                <th>완료</th>
                <th>수량</th>
                <th>입력 가격</th>
                <th>요율</th>
                <th>거래 금액</th>
                <th>수수료</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/ops/orders/${o.id}`}>{o.orderNumber}</Link>
                  </td>
                  <td>{new Date(o.completedAt).toLocaleString('ko-KR')}</td>
                  <td>
                    {formatUnits(o.amount, ASSETS[o.asset as AssetCode]?.decimals ?? 0)} {o.asset}
                  </td>
                  <td>{formatKrw(o.basePriceMinor)}</td>
                  <td>{formatRate(o.feeRateBp)}</td>
                  <td>{formatKrw(o.fiatAmountMinor)}</td>
                  <td>{formatKrw(o.feeFiatMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
