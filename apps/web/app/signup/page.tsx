'use client';

import { FormEvent, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('auth/signup', { body: { email, password } });
      await api('auth/login', { body: { email, password } });
      window.location.href = '/account';
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>가입하기</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="email">이메일</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">비밀번호 (10자 이상, 영문과 숫자 포함)</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <label htmlFor="confirm">비밀번호 확인</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <ErrorText error={error} />
        <button className="full" disabled={busy}>
          가입하기
        </button>
      </form>
    </div>
  );
}
