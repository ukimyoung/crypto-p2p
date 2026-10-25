'use client';

import { FormEvent, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { NicknameInput } from '@/components/NicknameInput';
import { PhoneField } from '@/components/PhoneField';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

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
  // Set once the confirmation email is on its way.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('비밀번호 확인이 일치하지 않습니다.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Emails go out in the language the user signed up in.
      const res = await api<{ email: string }>('auth/signup', {
        body: { email, password, phoneCountry, phoneNumber, nickname, firstName, lastName, locale },
      });
      setSentTo(res.email);
    } catch (err) {
      setError(messageOf(err));
    }
    setBusy(false);
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await api('auth/signup/resend', { body: { email: sentTo } });
      setResent(true);
    } catch (err) {
      setError(messageOf(err));
    }
    setBusy(false);
  }

  if (sentTo) {
    return (
      <div className="narrow">
        <h1>{t('이메일을 확인해 주세요')}</h1>
        <div className="card">
          <p>{t('{email}(으)로 인증 메일을 보냈습니다.', { email: sentTo })}</p>
          <p className="muted">
            {t('메일의 링크를 누르면 이메일 인증과 가입이 완료됩니다. 링크는 24시간 동안 유효합니다.')}
          </p>
          <p className="muted small-text">
            {t('메일이 보이지 않으면 스팸함을 확인하거나 1분 뒤에 다시 보내 주세요.')}
          </p>
          {resent && <p className="small-text">{t('인증 메일을 다시 보냈습니다.')}</p>}
          <ErrorText error={error} />
          <button type="button" className="full secondary" onClick={resend} disabled={busy}>
            {t('인증 메일 다시 보내기')}
          </button>
        </div>
      </div>
    );
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
