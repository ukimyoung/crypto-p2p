'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

/**
 * Signup links from emails sent before email confirmation was dropped still land here.
 * Those signups were turned into accounts, so the member only needs to log in.
 */
export default function VerifySignUpPage() {
  const { t } = useT();
  return (
    <div className="narrow">
      <h1>{t('이메일 인증')}</h1>
      <div className="card">
        <p>{t('이제 이메일 인증 없이 바로 가입됩니다. 가입할 때 정한 이메일과 비밀번호로 로그인해 주세요.')}</p>
        <p className="muted small-text">
          <Link href="/login">{t('로그인')}</Link> · <Link href="/signup">{t('가입하기')}</Link>
        </p>
      </div>
    </div>
  );
}
