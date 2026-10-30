'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { LOCALE_COOKIE } from '@/lib/locale';
import type { Me } from '@/lib/types';

/** Opened from the signup email: confirms the address, creates the account and logs the member in. */
export default function VerifySignUpPage() {
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // The link works once, so a second effect run must not use it again.
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setError('인증 링크가 올바르지 않습니다. 이미 사용했거나 새 링크로 바뀌었을 수 있습니다.');
      return;
    }
    api<{ user: Me }>('auth/signup/verify', { body: { token } })
      .then(({ user }) => {
        document.cookie = `${LOCALE_COOKIE}=${user.locale}; path=/; max-age=31536000; samesite=lax`;
        // Full reload so the header picks up the new session.
        window.location.href = '/account';
      })
      .catch((err) => setError(messageOf(err)));
  }, []);

  return (
    <div className="narrow">
      <h1>{t('이메일 인증')}</h1>
      <div className="card">
        {error ? (
          <>
            <ErrorText error={error} />
            <p className="muted small-text">
              <Link href="/signup">{t('다시 가입하기')}</Link> · <Link href="/login">{t('로그인')}</Link>
            </p>
          </>
        ) : (
          <p className="muted">{t('이메일을 인증하고 가입을 마치는 중입니다…')}</p>
        )}
      </div>
    </div>
  );
}
