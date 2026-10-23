'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { INVOICE_STATUS } from '@/lib/messages';
import type { FeeInvoice, InvoiceStatus } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatUnits, kstDate } from '@/lib/units';
import { isAdmin } from '@/lib/use-operator';
import { useCurrentOperator } from '../OpsShell';

const TABS: (InvoiceStatus | 'all')[] = ['all', 'overdue', 'issued', 'partially_paid', 'paid'];
const PAGE_SIZE = 20;

interface Summary {
  from: string;
  to: string;
  totals: {
    fiat: string;
    earnedMinor: string;
    unbilledMinor: string;
    paidMinor: string;
    outstandingMinor: string;
    overdueMinor: string;
  }[];
  makers: {
    makerId: string;
    makerEmail: string | null;
    fiat: string;
    outstandingMinor: string;
    overdueMinor: string;
    invoices: number;
  }[];
  feeRevenueByAsset: { asset: string; amount: string }[];
}

export default function OpsFeesPage() {
  const operator = useCurrentOperator();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ invoices: FeeInvoice[]; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummary(await api<Summary>('ops/fees/summary'));
  }, []);

  const loadList = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page) });
    if (status !== 'all') q.set('status', status);
    setList(await api<{ invoices: FeeInvoice[]; total: number }>(`ops/fee-invoices?${q}`));
  }, [status, page]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setList(null);
    void loadList();
  }, [loadList]);

  async function runBilling() {
    setError(null);
    setMessage(null);
    try {
      const r = await api<{ issued: number; reminded: number; overdue: number }>('ops/fees/run-billing', {
        method: 'POST',
      });
      setMessage(`청구서 ${r.issued}건 발행, 알림 ${r.reminded}건, 연체 처리 ${r.overdue}건`);
      await Promise.all([loadSummary(), loadList()]);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  const krw = summary?.totals.find((t) => t.fiat === 'KRW');
  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <>
      <h1>수수료 청구</h1>
      <section className="card">
        <h2>
          이번 달 요약{' '}
          {summary && (
            <span className="muted small-text">
              {kstDate(summary.from)} ~ {kstDate(summary.to, true)}
            </span>
          )}
        </h2>
        {!krw && <p className="muted">불러오는 중…</p>}
        {krw && (
          <div className="stats">
            <div>
              <div className="muted small-text">확정 수수료 (완료 주문)</div>
              <div className="price">{formatKrw(krw.earnedMinor)}</div>
              <div className="muted small-text">그중 아직 청구 전 {formatKrw(krw.unbilledMinor)}</div>
            </div>
            <div>
              <div className="muted small-text">이번 달 납부</div>
              <div className="price">{formatKrw(krw.paidMinor)}</div>
            </div>
            <div>
              <div className="muted small-text">미납 합계 (전체 기간)</div>
              <div className="price">{formatKrw(krw.outstandingMinor)}</div>
              <div className="muted small-text">그중 연체 {formatKrw(krw.overdueMinor)}</div>
            </div>
          </div>
        )}
        {summary && summary.feeRevenueByAsset.length > 0 && (
          <p className="muted small-text">
            출금 수수료 누적:{' '}
            {summary.feeRevenueByAsset
              .map((f) => `${formatUnits(f.amount, ASSETS[f.asset as AssetCode]?.decimals ?? 0)} ${f.asset}`)
              .join(', ')}
          </p>
        )}
        {isAdmin(operator) && (
          <p>
            <button type="button" className="small" onClick={runBilling}>
              지금 청구 실행
            </button>{' '}
            <span className="muted small-text">
              보통은 몇 분마다 자동으로 돕니다. 끝난 기간의 청구서 발행, 기한 알림, 연체 처리를 바로 합니다.
            </span>
          </p>
        )}
        {message && <p className="muted small-text">{message}</p>}
        <ErrorText error={error} />
      </section>

      {summary && summary.makers.length > 0 && (
        <section className="card">
          <h2>미납 광고주</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>광고주</th>
                  <th>미납</th>
                  <th>연체</th>
                  <th>청구서</th>
                </tr>
              </thead>
              <tbody>
                {summary.makers.map((m) => (
                  <tr key={`${m.makerId}-${m.fiat}`}>
                    <td>
                      <Link href={`/ops/users/${m.makerId}`}>{m.makerEmail ?? m.makerId.slice(0, 8)}</Link>
                    </td>
                    <td>{formatKrw(m.outstandingMinor)}</td>
                    <td className={BigInt(m.overdueMinor) > 0n ? 'error' : 'muted'}>{formatKrw(m.overdueMinor)}</td>
                    <td>{m.invoices}건</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h2>청구서</h2>
        <div className="tabs" style={{ marginBottom: 16 }}>
          {TABS.map((s) => (
            <button
              key={s}
              type="button"
              className={s === status ? 'active neutral' : ''}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {s === 'all' ? '전체' : INVOICE_STATUS[s]}
            </button>
          ))}
        </div>
        {list === null && <p className="muted">불러오는 중…</p>}
        {list?.invoices.length === 0 && <p className="muted">해당하는 청구서가 없습니다.</p>}
        {list && list.invoices.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>광고주</th>
                  <th>기간</th>
                  <th>청구 금액</th>
                  <th>납부</th>
                  <th>납부 기한</th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{i.makerEmail ?? i.makerId.slice(0, 8)}</td>
                    <td>
                      {kstDate(i.periodStart)} ~ {kstDate(i.periodEnd, true)}
                    </td>
                    <td>{formatKrw(i.totalMinor)}</td>
                    <td>{formatKrw(i.paidMinor)}</td>
                    <td>{kstDate(i.dueAt, true)}</td>
                    <td>
                      <span className={`badge invoice-${i.status}`}>{INVOICE_STATUS[i.status]}</span>
                    </td>
                    <td>
                      <Link href={`/ops/fees/${i.id}`}>상세</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list && pages > 1 && (
          <div className="pager">
            <button type="button" className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              이전
            </button>
            <span className="muted small-text">
              {page} / {pages} 쪽 (총 {list.total}건)
            </span>
            <button type="button" className="small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              다음
            </button>
          </div>
        )}
      </section>
    </>
  );
}
