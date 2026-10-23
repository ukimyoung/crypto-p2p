'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AuditTable } from '@/components/AuditTable';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { BANKS, ORDER_STATUS, USER_STATUS, WITHDRAWAL_STATUS } from '@/lib/messages';
import { AD_STATUS } from '@/lib/ops-labels';
import type { AuditEntry, Balance, Order, PaymentMethod, UserSummary, Withdrawal } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatUnits } from '@/lib/units';
import { withStepUp } from '@/lib/use-operator';

interface Detail {
  user: UserSummary;
  balances: Balance[];
  orders: Order[];
  withdrawals: Withdrawal[];
  paymentMethods: PaymentMethod[];
  logins: { success: boolean; reason: string | null; ip: string | null; userAgent: string | null; createdAt: string }[];
  addresses: { id: string; asset: string; address: string; label: string; status: string; createdAt: string }[];
  ads: {
    id: string;
    side: 'buy' | 'sell';
    asset: string;
    fiat: string;
    priceMinor: string;
    remainingAmount: string;
    status: string;
    createdAt: string;
  }[];
}

const TABS = [
  ['balances', '잔고'],
  ['orders', '주문'],
  ['withdrawals', '출금'],
  ['payment', '결제수단'],
  ['addresses', '출금 주소'],
  ['ads', '광고'],
  ['logins', '로그인 기록'],
  ['history', '처리 이력'],
] as const;
type Tab = (typeof TABS)[number][0];

const fmt = (v: string, asset: string) => `${formatUnits(v, ASSETS[asset as AssetCode]?.decimals ?? 0)} ${asset}`;
const when = (d: string) => new Date(d).toLocaleString('ko-KR');

export default function OpsUserPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; operatorNames: Record<string, string> } | null>(null);
  const [tab, setTab] = useState<Tab>('balances');
  const [pii, setPii] = useState<{ email: string | null; phone: string | null; legalName: string | null } | null>(null);
  const [status, setStatus] = useState<UserSummary['status']>('active');
  const [reason, setReason] = useState('');
  const [kycLevel, setKycLevel] = useState(0);
  const [kycReason, setKycReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [detail, log] = await Promise.all([
      api<Detail>(`ops/users/${id}`),
      api<{ entries: AuditEntry[]; operatorNames: Record<string, string> }>(`ops/audit?targetId=${id}`),
    ]);
    setData(detail);
    setStatus(detail.user.status);
    setKycLevel(detail.user.kycLevel);
    setAudit(log);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reveal() {
    const why = window.prompt('개인정보 전체 보기 사유 (감사 로그에 남습니다)');
    if (!why?.trim()) return;
    setError(null);
    try {
      setPii((await api<{ pii: typeof pii }>(`ops/users/${id}/reveal`, { body: { reason: why } })).pii);
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

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

  async function changeKyc(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!window.confirm(`KYC 등급을 ${kycLevel}(으)로 바꿀까요? 보통은 본인인증 결과로 정해집니다.`)) return;
    try {
      await api(`ops/users/${id}/kyc-level`, { body: { level: kycLevel, reason: kycReason } });
      setKycReason('');
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
        <Link href="/ops/users">← 회원</Link>
      </p>
      <h1>
        {user.email ?? '회원'}{' '}
        <span className={`badge ${user.status === 'active' ? 'completed' : 'under_review'}`}>{USER_STATUS[user.status]}</span>
      </h1>
      <ErrorText error={error} />

      <div className="grid2">
        <section className="card">
          <h2>기본 정보</h2>
          <dl className="kv">
            <dt>회원 ID</dt>
            <dd className="address">{user.id}</dd>
            <dt>이메일</dt>
            <dd>{pii?.email ?? user.email ?? '-'}</dd>
            <dt>전화</dt>
            <dd>{pii ? (pii.phone ?? '-') : (user.phone ?? '-')}</dd>
            <dt>실명</dt>
            <dd>{pii ? (pii.legalName ?? '미인증') : (user.legalName ?? '미인증')}</dd>
            <dt>KYC</dt>
            <dd>{user.kycLevel}단계</dd>
            <dt>OTP</dt>
            <dd>{user.otpEnabled ? '사용 중' : '미등록'}</dd>
            <dt>가입일</dt>
            <dd>{when(user.createdAt)}</dd>
            {user.statusReason && (
              <>
                <dt>제한 사유</dt>
                <dd>{user.statusReason}</dd>
              </>
            )}
          </dl>
          {!pii && (
            <button type="button" className="small secondary" onClick={reveal}>
              개인정보 전체 보기 (사유 필요)
            </button>
          )}
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
          </form>
          <form onSubmit={changeKyc} className="settings-form">
            <h3>KYC 등급 수동 조정</h3>
            <p className="muted small-text">예외가 필요할 때만 씁니다. 보통은 본인인증(Sumsub) 결과로 정해집니다.</p>
            <div className="grid2">
              <div>
                <label htmlFor="kyc">등급</label>
                <select id="kyc" value={kycLevel} onChange={(e) => setKycLevel(Number(e.target.value))}>
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}단계
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="kyc-reason">사유</label>
                <input id="kyc-reason" value={kycReason} onChange={(e) => setKycReason(e.target.value)} required />
              </div>
            </div>
            <button className="secondary">등급 변경</button>
          </form>
        </section>
      </div>

      <div className="tabs" style={{ margin: '8px 0 16px', flexWrap: 'wrap' }}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'active neutral' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <section className="card">
        {tab === 'balances' && (
          <Table head={['코인', '사용 가능', '거래 중 잠김', '출금 처리 중']} empty="잔고가 없습니다.">
            {data.balances.map((b) => (
              <tr key={b.asset}>
                <td>{b.asset}</td>
                <td>{fmt(b.available, b.asset)}</td>
                <td>{fmt(b.escrow, b.asset)}</td>
                <td>{fmt(b.withdrawalPending, b.asset)}</td>
              </tr>
            ))}
          </Table>
        )}
        {tab === 'orders' && (
          <Table head={['시각', '역할', '수량', '금액', '상태']} empty="주문이 없습니다.">
            {data.orders.map((o) => (
              <tr key={o.id}>
                <td>{o.createdAt ? when(o.createdAt) : '-'}</td>
                <td>{o.buyerId === user.id ? '구매' : '판매'}</td>
                <td>{fmt(o.amount, o.asset)}</td>
                <td>{formatKrw(o.fiatAmountMinor)}</td>
                <td>
                  <Link href={`/ops/orders/${o.id}`}>{ORDER_STATUS[o.status]}</Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {tab === 'withdrawals' && (
          <Table head={['신청', '수량', '주소', '상태']} empty="출금이 없습니다.">
            {data.withdrawals.map((w) => (
              <tr key={w.id}>
                <td>{when(w.createdAt)}</td>
                <td>{fmt(w.amount, w.asset)}</td>
                <td className="address">{w.address}</td>
                <td>{WITHDRAWAL_STATUS[w.status]}</td>
              </tr>
            ))}
          </Table>
        )}
        {tab === 'payment' && (
          <Table head={['은행', '계좌', '예금주', '사용 가능 시각']} empty="등록한 계좌가 없습니다.">
            {data.paymentMethods.map((m) => (
              <tr key={m.id}>
                <td>{BANKS[m.bankCode] ?? m.bankCode}</td>
                <td>{m.accountMasked}</td>
                <td>{m.accountHolder}</td>
                <td>{when(m.usableFrom)}</td>
              </tr>
            ))}
          </Table>
        )}
        {tab === 'addresses' && (
          <Table head={['등록', '코인', '주소', '이름', '상태']} empty="출금 주소가 없습니다.">
            {data.addresses.map((a) => (
              <tr key={a.id}>
                <td>{when(a.createdAt)}</td>
                <td>{a.asset}</td>
                <td className="address">{a.address}</td>
                <td>{a.label || '-'}</td>
                <td>{a.status === 'active' ? '사용 중' : '삭제됨'}</td>
              </tr>
            ))}
          </Table>
        )}
        {tab === 'ads' && (
          <Table head={['등록', '종류', '가격', '남은 수량', '상태']} empty="광고가 없습니다.">
            {data.ads.map((a) => (
              <tr key={a.id}>
                <td>{when(a.createdAt)}</td>
                <td>
                  {a.asset} {a.side === 'sell' ? '팔기' : '사기'}
                </td>
                <td>{formatKrw(a.priceMinor)}</td>
                <td>{fmt(a.remainingAmount, a.asset)}</td>
                <td>
                  <Link href={`/ops/ads/${a.id}`}>{AD_STATUS[a.status] ?? a.status}</Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {tab === 'logins' && (
          <Table head={['시각', '결과', 'IP', '기기']} empty="로그인 기록이 없습니다.">
            {data.logins.map((l, i) => (
              <tr key={i}>
                <td>{when(l.createdAt)}</td>
                <td>{l.success ? '성공' : `실패 (${l.reason ?? '-'})`}</td>
                <td>{l.ip ?? '-'}</td>
                <td className="muted small-text">{l.userAgent ?? '-'}</td>
              </tr>
            ))}
          </Table>
        )}
        {tab === 'history' && audit && <AuditTable entries={audit.entries} names={audit.operatorNames} />}
      </section>
    </>
  );
}

function Table({ head, empty, children }: { head: string[]; empty: string; children: React.ReactNode[] }) {
  if (children.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
