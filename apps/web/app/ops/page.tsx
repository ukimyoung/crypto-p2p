'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function OpsDashboard() {
  const [summary, setSummary] = useState<{ pendingWithdrawals: number; openDisputes: number; autoReviewDisputes: number } | null>(null);

  useEffect(() => {
    const load = () => api<{ pendingWithdrawals: number; openDisputes: number; autoReviewDisputes: number }>('ops/summary').then(setSummary);
    void load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <h1>대시보드</h1>
      <div className="stats">
        <Link href="/ops/withdrawals" className="card stat">
          <span className="muted">검토 대기 출금</span>
          <strong>{summary?.pendingWithdrawals ?? '-'}</strong>
        </Link>
        <Link href="/ops/disputes" className="card stat">
          <span className="muted">진행 중인 분쟁</span>
          <strong>{summary?.openDisputes ?? '-'}</strong>
          {summary && summary.autoReviewDisputes > 0 && (
            <span className="muted small-text">그중 자동 전환 {summary.autoReviewDisputes}건</span>
          )}
        </Link>
      </div>
      <p className="muted small-text">15초마다 새로 고칩니다.</p>
    </>
  );
}
