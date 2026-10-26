'use client';

import { FormEvent, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { NicknameInput } from '@/components/NicknameInput';
import { PhoneField } from '@/components/PhoneField';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { LOCALE_COOKIE } from '@/lib/locale';
import type { Me } from '@/lib/types';

export default function SignUpPage() {
  const { t, locale } = useT();
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('KR');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('비밀번호 확인이 일치하지 않습니다.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Emails and the site use the language the member signed up in.
      const { user } = await api<{ user: Me }>('auth/signup', {
        body: { email, password, phoneCountry, phoneNumber, nickname, firstName, lastName, locale },
      });
      document.cookie = `${LOCALE_COOKIE}=${user.locale}; path=/; max-age=31536000; samesite=lax`;
      // Full reload so the header picks up the new session.
      window.location.href = '/account';
      return;
    } catch (err) {
      setError(messageOf(err));
    }
    setBusy(false);
  }

  return (
    <div className="narrow">
      <h1>{t('가입하기')}</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="email">{t('이메일')}</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div className="name-fields">
          <div>
            <label htmlFor="firstName">{t('이름 (First name)')}</label>
            <input
              id="firstName"
              autoComplete="given-name"
              maxLength={50}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="lastName">{t('성 (Last name)')}</label>
            <input
              id="lastName"
              autoComplete="family-name"
              maxLength={50}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
        </div>
        <p className="muted small-text" style={{ margin: '6px 0 0' }}>
          {t('이름은 가입한 뒤에는 바꿀 수 없으니 정확히 입력해 주세요.')}
        </p>
        <NicknameInput value={nickname} onChange={setNickname} />
        <PhoneField
          id="phone"
          country={phoneCountry}
          number={phoneNumber}
          onCountry={setPhoneCountry}
          onNumber={setPhoneNumber}
        />
        <label htmlFor="password">{t('비밀번호 (10자 이상, 영문과 숫자 포함, 특수문자 사용 가능)')}</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <label htmlFor="confirm">{t('비밀번호 확인')}</label>
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
          {t('가입하기')}
        </button>
      </form>
    </div>
  );
}
