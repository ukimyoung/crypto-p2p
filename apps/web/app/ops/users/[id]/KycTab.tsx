'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { SUMSUB_STATUS, sumsubResult } from '@/lib/ops-labels';
import type { OpsKyc } from '@/lib/types';

const when = (d: string) => new Date(d).toLocaleString('ko-KR');

/** Sumsub status for the member (KYC-4), with a re-sync and a re-check request (KYC-5). */
export function KycTab({ userId, onChanged }: { userId: string; onChanged: () => Promise<void> }) {
  const [kyc, setKyc] = useState<OpsKyc | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setKyc(await api<OpsKyc>(`ops/users/${userId}/kyc`));
  }, [userId]);

  useEffect(() => {
    load().catch((err) => setError(messageOf(err)));
  }, [load]);

  async function run(action: () => Promise<OpsKyc>) {
    setError(null);
    setBusy(true);
    try {
      setKyc(await action());
      await onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  function requestCheck(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm('Sumsub에 이 회원의 재심사를 요청할까요?')) return;
    void run(async () => {
      const res = await api<OpsKyc>(`ops/users/${userId}/kyc/request-check`, { body: { reason } });
      setReason('');
      return res;
    });
  }

  if (!kyc) return <ErrorText error={error} />;
  const a = kyc.applicant;
  return (
    <div>
      {!kyc.configured && (
        <p className="notice">Sumsub 키가 아직 등록되지 않아 재동기화와 재심사 요청을 쓸 수 없습니다.</p>
      )}
      {!a ? (
        <p className="muted">이 회원은 아직 본인 인증을 시작하지 않았습니다.</p>
      ) : (
        <dl className="kv">
          <dt>Sumsub 상태</dt>
          <dd>{SUMSUB_STATUS[a.reviewStatus] ?? a.reviewStatus}</dd>
          <dt>심사 결과</dt>
          <dd>{sumsubResult(a.reviewStatus, a.reviewAnswer, a.rejectType)}</dd>
          <dt>거절 사유</dt>
          <dd>
            {a.rejectLabels.length > 0 ? a.rejectLabels.join(', ') : '-'}
            {a.moderationComment && <div className="small-text">회원 안내: {a.moderationComment}</div>}
            {a.clientComment && <div className="small-text muted">내부 메모: {a.clientComment}</div>}
          </dd>
          <dt>마지막 갱신</dt>
          <dd>{when(a.updatedAt)}</dd>
          <dt>지원자 ID</dt>
          <dd>
            <code>{a.applicantId}</code>{' '}
            <a href={a.consoleUrl} target="_blank" rel="noopener noreferrer">
              Sumsub 콘솔에서 보기
            </a>
          </dd>
        </dl>
      )}
      <p className="muted small-text">신분증 이미지는 이 서비스에 저장하지 않습니다. 원본은 Sumsub 콘솔에서만 확인하세요.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <button
          type="button"
          className="secondary"
          disabled={busy || !kyc.configured}
          onClick={() => run(() => api<OpsKyc>(`ops/users/${userId}/kyc/sync`, { method: 'POST' }))}
        >
          Sumsub에서 상태 다시 가져오기
        </button>
      </div>
      {a && (
        <form onSubmit={requestCheck} className="settings-form">
          <h3>재심사 요청</h3>
          <label htmlFor="kyc-check-reason">사유</label>
          <input id="kyc-check-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          <button className="full" disabled={busy || !kyc.configured}>
            재심사 요청
          </button>
        </form>
      )}
      {kyc.webhooks.length > 0 && (
        <>
          <h3>최근 웹훅</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>받은 시각</th>
                  <th>이벤트</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {kyc.webhooks.map((w, i) => (
                  <tr key={i}>
                    <td>{when(w.receivedAt)}</td>
                    <td>{w.type}</td>
                    <td>{w.reviewStatus ? (SUMSUB_STATUS[w.reviewStatus] ?? w.reviewStatus) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}
