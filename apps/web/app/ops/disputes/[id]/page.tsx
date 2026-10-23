'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { ORDER_STATUS, USER_STATUS } from '@/lib/messages';
import type { DisputeResolution, Message, Order, UserSummary } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatUnits } from '@/lib/units';
import { withStepUp } from '@/lib/use-operator';

interface Case {
  order: Order;
  messages: Message[];
  resolutions: DisputeResolution[];
  buyer: UserSummary;
  seller: UserSummary;
  operatorNames: Record<string, string>;
}

const DECISION = { release: '구매자에게 코인 지급', refund: '판매자에게 환불' };
// Proposals left over from the old two-person flow were closed as declined.
const RESOLUTION_STATUS = { proposed: '대기', approved: '실행됨', declined: '취소됨' };

export default function OpsDisputePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Case | null>(null);
  const [decision, setDecision] = useState<'release' | 'refund'>('release');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setData(await api<Case>(`ops/disputes/${id}`)), [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (!data) return <p className="muted">불러오는 중…</p>;
  const { order, buyer, seller } = data;
  const decimals = ASSETS[order.asset as AssetCode]?.decimals ?? 0;
  const name = (opId: string | null) => (opId ? (data.operatorNames[opId] ?? opId.slice(0, 8)) : '-');
  const role = (senderId: string) => (senderId === order.buyerId ? '구매자' : '판매자');

  function resolve(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm(`${DECISION[decision]}를 실행할까요? 코인이 바로 이동하고 되돌릴 수 없습니다.`)) return;
    void run(async () => {
      if (await withStepUp(() => api(`ops/disputes/${id}/resolve`, { body: { decision, reason } }))) setReason('');
    });
  }

  return (
    <>
      <p className="small-text">
        <Link href="/ops/disputes">← 분쟁 목록</Link>
      </p>
      <h1>
        분쟁 주문 {order.id.slice(0, 8)} <span className={`badge ${order.status}`}>{ORDER_STATUS[order.status]}</span>
      </h1>

      <div className="grid2">
        <section className="card">
          <h2>주문</h2>
          <dl className="kv">
            <dt>수량</dt>
            <dd>
              {formatUnits(order.amount, decimals)} {order.asset}
            </dd>
            <dt>에스크로</dt>
            <dd>
              {formatUnits(order.escrowAmount, decimals)} {order.asset}
            </dd>
            <dt>금액</dt>
            <dd>{formatKrw(order.fiatAmountMinor)}</dd>
            <dt>주문 시각</dt>
            <dd>{order.createdAt ? new Date(order.createdAt).toLocaleString('ko-KR') : '-'}</dd>
            <dt>이체 완료 표시</dt>
            <dd>{order.paidAt ? new Date(order.paidAt).toLocaleString('ko-KR') : '-'}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>당사자</h2>
          <dl className="kv">
            {(
              [
                ['구매자', buyer],
                ['판매자', seller],
              ] as const
            ).map(([label, u]) => (
              <div key={u.id} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>
                  <Link href={`/ops/users/${u.id}`}>{u.legalName ?? u.email ?? u.id.slice(0, 8)}</Link>{' '}
                  <span className="muted small-text">
                    KYC {u.kycLevel} · {USER_STATUS[u.status]}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="card">
        <h2>주문 채팅 ({data.messages.length})</h2>
        {data.messages.length === 0 && <p className="muted">메시지가 없습니다.</p>}
        <div className="chat" style={{ maxHeight: 420 }}>
          {data.messages.map((m) => (
            <div key={m.id} className={`bubble ${m.senderId === order.sellerId ? 'mine' : ''}`}>
              <div className="small-text" style={{ opacity: 0.8 }}>
                {role(m.senderId)} · {new Date(m.createdAt).toLocaleString('ko-KR')}
              </div>
              {m.body}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>결정</h2>
        {data.resolutions.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>결정</th>
                  <th>사유</th>
                  <th>처리자</th>
                  <th>상태</th>
                  <th>시각</th>
                </tr>
              </thead>
              <tbody>
                {data.resolutions.map((r) => (
                  <tr key={r.id}>
                    <td>{DECISION[r.decision]}</td>
                    <td>{r.reason}</td>
                    <td>{name(r.decidedBy ?? r.proposedBy)}</td>
                    <td>{RESOLUTION_STATUS[r.status]}</td>
                    <td>{new Date(r.decidedAt ?? r.createdAt).toLocaleString('ko-KR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {order.status === 'under_review' && (
          <form onSubmit={resolve} style={{ marginTop: 16 }}>
            <label htmlFor="decision">결정</label>
            <select id="decision" value={decision} onChange={(e) => setDecision(e.target.value as 'release' | 'refund')}>
              <option value="release">{DECISION.release}</option>
              <option value="refund">{DECISION.refund}</option>
            </select>
            <label htmlFor="reason">사유와 근거 (감사 로그에 남습니다)</label>
            <textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
            <button className="full">결정하고 실행 (OTP 확인)</button>
          </form>
        )}
        {order.status !== 'under_review' && <p className="muted">이 주문은 처리가 끝났습니다.</p>}
        <ErrorText error={error} />
      </section>
    </>
  );
}
