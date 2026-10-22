'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AuditTable } from '@/components/AuditTable';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import type { AuditEntry } from '@/lib/types';

export default function OpsAuditPage() {
  const [targetId, setTargetId] = useState('');
  const [actorId, setActorId] = useState('');
  const [data, setData] = useState<{ entries: AuditEntry[]; operatorNames: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filter: { targetId?: string; actorId?: string }) => {
    setError(null);
    const params = new URLSearchParams();
    if (filter.targetId) params.set('targetId', filter.targetId);
    if (filter.actorId) params.set('actorId', filter.actorId);
    try {
      setData(await api(`ops/audit?${params}`));
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void load({});
  }, [load]);

  function search(e: FormEvent) {
    e.preventDefault();
    void load({ targetId: targetId.trim(), actorId: actorId.trim() });
  }

  return (
    <>
      <h1>감사 로그</h1>
      <form className="card" onSubmit={search}>
        <div className="grid2">
          <div>
            <label htmlFor="target">대상 ID (회원, 주문, 출금 등)</label>
            <input id="target" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
          </div>
          <div>
            <label htmlFor="actor">행위자 ID (회원 또는 운영자)</label>
            <input id="actor" value={actorId} onChange={(e) => setActorId(e.target.value)} />
          </div>
        </div>
        <button className="full">조회</button>
        <ErrorText error={error} />
      </form>
      <section className="card">
        {data ? <AuditTable entries={data.entries} names={data.operatorNames} /> : <p className="muted">불러오는 중…</p>}
        <p className="muted small-text" style={{ marginBottom: 0 }}>
          최근 100건까지 보입니다. 기록은 수정하거나 지울 수 없습니다.
        </p>
      </section>
    </>
  );
}
