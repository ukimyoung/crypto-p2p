'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { USER_STATUS } from '@/lib/messages';
import type { UserSummary } from '@/lib/types';

export default function OpsUsersPage() {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setUsers((await api<{ users: UserSummary[] }>(`ops/users?q=${encodeURIComponent(q)}`)).users);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <>
      <h1>회원</h1>
      <form className="card" onSubmit={search}>
        <label htmlFor="q">이메일 일부, 회원 ID 또는 실명</label>
        <div className="row">
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <button>검색</button>
        </div>
        <ErrorText error={error} />
      </form>
      {users && (
        <section className="card">
          {users.length === 0 && <p className="muted">찾은 회원이 없습니다.</p>}
          {users.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>이메일</th>
                    <th>실명</th>
                    <th>KYC</th>
                    <th>상태</th>
                    <th>가입일</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link href={`/ops/users/${u.id}`}>{u.email ?? u.id.slice(0, 8)}</Link>
                      </td>
                      <td>{u.legalName ?? '-'}</td>
                      <td>{u.kycLevel}</td>
                      <td>{USER_STATUS[u.status]}</td>
                      <td>{new Date(u.createdAt).toLocaleDateString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
