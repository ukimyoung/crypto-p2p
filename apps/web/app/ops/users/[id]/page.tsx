'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AuditTable } from '@/components/AuditTable';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { BANKS, ORDER_STATUS, USER_STATUS, WITHDRAWAL_STATUS } from '@/lib/messages';
import type { AuditEntry, Balance, Order, PaymentMethod, UserSummary, Withdrawal } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatUnits } from '@/lib/units';
import { withStepUp } from '@/lib/use-operator';

interface Detail {
  user: UserSummary;
  balances: Balance[];
  orders: Order[];
  withdrawals: Withdrawal[];
  paymentMethods: PaymentMethod[];
}

const fmt = (v: string, asset: string) => `${formatUnits(v, ASSETS[asset as AssetCode]?.decimals ?? 0)} ${asset}`;

export default function OpsUserPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; operatorNames: Record<string, string> } | null>(null);
  const [status, setStatus] = useState<UserSummary['status']>('active');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [detail, log] = await Promise.all([
      api<Detail>(`ops/users/${id}`),
      api<{ entries: AuditEntry[]; operatorNames: Record<string, string> }>(`ops/audit?targetId=${id}`),
    ]);
    setData(detail);
    setStatus(detail.user.status);
    setAudit(log);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!window.confirm(`계정 상태를 '${USER_STATUS[status]}'(으)로 바꿀까요?`)) return;
    try {
      if (!(await withStepUp(() => api(`ops/users/${id}/status`, { body: { status, reason } })))) return;
      setReason('');
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (!data) return <p className="muted">불러오는 중…</p>;
  const { user } = data;

  return (
    <>
      <p className="small-text">
        <Link href="/ops/users">← 회원 검색</Link>
      </p>
      <h1>
        {user.legalName ?? user.email ?? '회원'} <span className={`badge ${user.status === 'active' ? 'completed' : 'under_review'}`}>{USER_STATUS[user.status]}</span>
      </h1>

      <div className="grid2">
        <section className="card">
          <h2>기본 정보</h2>
          <dl className="kv">
            <dt>회원 ID</dt>
            <dd className="address">{user.id}</dd>
            <dt>이메일</dt>
            <dd>{user.email ?? '-'}</dd>
            <dt>실명</dt>
            <dd>{user.legalName ?? '미인증'}</dd>
            <dt>KYC</dt>
            <dd>{user.kycLevel}단계</dd>
            <dt>OTP</dt>
            <dd>{user.otpEnabled ? '사용 중' : '미등록'}</dd>
            <dt>가입일</dt>
            <dd>{new Date(user.createdAt).toLocaleString('ko-KR')}</dd>
            {user.statusReason && (
              <>
                <dt>제한 사유</dt>
                <dd>{user.statusReason}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="card">
          <h2>계정 상태 변경</h2>
          <form onSubmit={changeStatus}>
            <label htmlFor="status">상태</label>
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value as UserSummary['status'])}>
              {Object.entries(USER_STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label htmlFor="reason">사유 (감사 로그에 남습니다)</label>
            <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
            <p className="muted small-text">
              거래 정지는 새 주문과 광고 거래를, 출금 보류는 출금을 막습니다. 해지하면 로그인이 끊기고, 해지할 때는
              OTP 코드를 다시 확인합니다. 진행 중인 주문과 출금은 그대로 처리됩니다.
            </p>
            <button className="full">변경</button>
            <ErrorText error={error} />
          </form>
        </section>
      </div>

      <section className="card">
        <h2>잔고</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>코인</th>
                <th>사용 가능</th>
                <th>거래 중 잠김</th>
                <th>출금 처리 중</th>
              </tr>
            </thead>
            <tbody>
              {data.balances.map((b) => (
                <tr key={b.asset}>
                  <td>{b.asset}</td>
                  <td>{fmt(b.available, b.asset)}</td>
                  <td>{fmt(b.escrow, b.asset)}</td>
                  <td>{fmt(b.withdrawalPending, b.asset)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>주문 ({data.orders.length})</h2>
        {data.orders.length === 0 ? (
          <p className="muted">주문이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>역할</th>
                  <th>수량</th>
                  <th>금액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.createdAt ? new Date(o.createdAt).toLocaleString('ko-KR') : '-'}</td>
                    <td>{o.buyerId === user.id ? '구매' : '판매'}</td>
                    <td>{fmt(o.amount, o.asset)}</td>
                    <td>{formatKrw(o.fiatAmountMinor)}</td>
                    <td>
                      {o.status === 'under_review' ? (
                        <Link href={`/ops/disputes/${o.id}`}>{ORDER_STATUS[o.status]}</Link>
                      ) : (
                        ORDER_STATUS[o.status]
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="card">
          <h2>출금 ({data.withdrawals.length})</h2>
          {data.withdrawals.length === 0 ? (
            <p className="muted">출금이 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {data.withdrawals.map((w) => (
                    <tr key={w.id}>
                      <td>{new Date(w.createdAt).toLocaleDateString('ko-KR')}</td>
                      <td>{fmt(w.amount, w.asset)}</td>
                      <td>{WITHDRAWAL_STATUS[w.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card">
          <h2>입금받을 계좌</h2>
          {data.paymentMethods.length === 0 ? (
            <p className="muted">등록한 계좌가 없습니다.</p>
          ) : (
            <ul>
              {data.paymentMethods.map((m) => (
                <li key={m.id}>
                  {BANKS[m.bankCode] ?? m.bankCode} {m.accountMasked} · {m.accountHolder}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>이 회원에 대한 기록</h2>
        {audit && <AuditTable entries={audit.entries} names={audit.operatorNames} />}
      </section>
    </>
  );
}
