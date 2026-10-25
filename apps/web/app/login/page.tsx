'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { LOCALE_COOKIE } from '@/lib/locale';
import type { Me } from '@/lib/types';

export default function LoginPage() {
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('auth/login', { body: { email, password } });
      // Show the site in the language saved on the account, also on a new device.
      const { user } = await api<{ user: Me }>('me');
      document.cookie = `${LOCALE_COOKIE}=${user.locale}; path=/; max-age=31536000; samesite=lax`;
      // Full reload so the header picks up the new session.
      window.location.href = '/market';
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>{t('로그인')}</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="email">{t('이메일')}</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">{t('비밀번호')}</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <ErrorText error={error} />
        <button className="full" disabled={busy}>
          {t('로그인')}
        </button>
        <p className="muted small-text">
          {t('계정이 없으신가요?')} <Link href="/signup">{t('가입하기')}</Link>
        </p>
      </form>
    </div>
  );
}
