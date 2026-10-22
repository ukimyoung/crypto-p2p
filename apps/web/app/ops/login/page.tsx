'use client';

import { FormEvent, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';

export default function OpsLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('ops/auth/login', { body: { email, password, otp } });
      window.location.href = '/ops';
    } catch (err) {
      setError(messageOf(err));
      setOtp('');
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>운영 콘솔 로그인</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="email">이메일</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <label htmlFor="otp">OTP 코드</label>
        <input id="otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} required />
        <ErrorText error={error} />
        <button className="full" disabled={busy}>
          로그인
        </button>
        <p className="muted small-text">운영자 계정은 관리자가 발급합니다. 모든 작업은 감사 로그에 남습니다.</p>
      </form>
    </div>
  );
}
