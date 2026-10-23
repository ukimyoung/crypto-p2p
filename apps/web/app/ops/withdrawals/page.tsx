'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { WITHDRAWAL_STATUS } from '@/lib/messages';
import type { Withdrawal, WithdrawalStatus } from '@/lib/types';
import { ASSETS, AssetCode, formatUnits } from '@/lib/units';
import { withStepUp } from '@/lib/use-operator';

const TABS: WithdrawalStatus[] = ['requested', 'approved', 'rejected', 'confirmed', 'failed'];
const fmt = (v: string, asset: string) => `${formatUnits(v, ASSETS[asset as AssetCode]?.decimals ?? 0)} ${asset}`;

export default function OpsWithdrawalsPage() {
  const [status, setStatus] = useState<WithdrawalStatus>('requested');
  const [rows, setRows] = useState<Withdrawal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows((await api<{ withdrawals: Withdrawal[] }>(`ops/withdrawals?status=${status}`)).withdrawals);
  }, [status]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  async function act(id: string, action: 'approve' | 'reject') {
    setError(null);
    let body: { note: string } | undefined;
    if (action === 'reject') {
      const note = window.prompt('거절 사유 (이용자에게 보입니다)');
      if (!note) return;
      body = { note };
    } else if (!window.confirm('이 출금을 승인할까요? 승인하면 송금 대기열로 넘어갑니다.')) {
      return;
    }
    try {
      await withStepUp(() => api(`ops/withdrawals/${id}/${action}`, { method: 'POST', body }));
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <>
      <h1>출금 검토</h1>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.map((s) => (
          <button key={s} type="button" className={s === status ? 'active neutral' : ''} onClick={() => setStatus(s)}>
            {WITHDRAWAL_STATUS[s]}
          </button>
        ))}
      </div>
      <ErrorText error={error} />
      <section className="card">
        {rows === null && <p className="muted">불러오는 중…</p>}
        {rows?.length === 0 && <p className="muted">해당하는 출금이 없습니다.</p>}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>신청 시각</th>
                  <th>회원</th>
                  <th>수량</th>
                  <th>주소</th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td>{new Date(w.createdAt).toLocaleString('ko-KR')}</td>
                    <td>
                      <Link href={`/ops/users/${w.userId}`}>{w.userId.slice(0, 8)}</Link>
                    </td>
                    <td>
                      {fmt(w.amount, w.asset)}
                      <div className="muted small-text">수수료 {fmt(w.fee, w.asset)}</div>
                    </td>
                    <td className="address">{w.address}</td>
                    <td>
                      <span className={`badge ${w.status}`}>{WITHDRAWAL_STATUS[w.status]}</span>
                      {w.reviewNote && <div className="muted small-text">{w.reviewNote}</div>}
                    </td>
                    <td>
                      {w.status === 'requested' && (
                        <div className="actions">
                          <button type="button" className="small" onClick={() => act(w.id, 'approve')}>
                            승인
                          </button>
                          <button type="button" className="small danger" onClick={() => act(w.id, 'reject')}>
                            거절
                          </button>
                        </div>
                      )}
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
