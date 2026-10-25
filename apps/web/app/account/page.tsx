'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { PhoneField } from '@/components/PhoneField';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BANKS } from '@/lib/messages';
import type { Me, PaymentMethod } from '@/lib/types';
import { useMe } from '@/lib/use-me';

export default function AccountPage() {
  const { me, reload } = useMe();
  const { t } = useT();

  if (me === undefined) return <p className="muted">{t('불러오는 중…')}</p>;
  if (me === null) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return null;
  }

  return (
    <>
      <h1>{t('내 계정')}</h1>
      <section className="card">
        <h2>{t('기본 정보')}</h2>
        <dl className="kv">
          <dt>{t('이메일')}</dt>
          <dd>{me.email}</dd>
          <dt>{t('휴대폰 번호')}</dt>
          <dd>{me.phone ?? t('미등록')}</dd>
          <dt>{t('본인인증(KYC)')}</dt>
          <dd>{me.kycLevel > 0 ? t('완료') : t('미완료')}</dd>
          <dt>OTP</dt>
          <dd>{t(me.otpEnabled ? '사용 중' : '미등록')}</dd>
        </dl>
        {me.kycLevel === 0 && (
          <p className="notice" style={{ marginTop: 16, marginBottom: 0 }}>
            {t('본인인증을 마쳐야 주문을 하고 입금 계좌를 등록할 수 있습니다.')}{' '}
            <Link href="/account/verify">{t('본인 인증하기')}</Link>
          </p>
        )}
      </section>
      <PhoneEdit me={me} onSaved={reload} />
      {!me.otpEnabled && <OtpSetup onEnabled={reload} />}
      {me.otpEnabled && <PaymentMethods />}
    </>
  );
}

/** Members who joined before phone numbers were asked add one here; others can change theirs. */
function PhoneEdit({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState(me.phoneCountry ?? 'KR');
  const [number, setNumber] = useState(me.phoneNational ?? '');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('me/phone', {
        body: { phoneCountry: country, phoneNumber: number, ...(me.otpEnabled ? { otp } : {}) },
      });
      setOtp('');
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (me.phone && !open) {
    return (
      <p className="small-text">
        <button className="link-button" onClick={() => setOpen(true)}>
          {t('휴대폰 번호 변경')}
        </button>
      </p>
    );
  }

  return (
    <section className="card">
      <h2>{t(me.phone ? '휴대폰 번호 변경' : '휴대폰 번호 등록')}</h2>
      {!me.phone && <p className="muted small-text">{t('연락받을 휴대폰 번호를 국가 번호와 함께 등록해 주세요.')}</p>}
      <form onSubmit={save}>
        <PhoneField id="account-phone" country={country} number={number} onCountry={setCountry} onNumber={setNumber} />
        {me.otpEnabled && (
          <>
            <label htmlFor="phone-otp">{t('OTP 코드')}</label>
            <input
              id="phone-otp"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
            />
          </>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          <button disabled={busy}>{t('저장')}</button>
          {me.phone && (
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              {t('취소')}
            </button>
          )}
        </div>
      </form>
      <ErrorText error={error} />
    </section>
  );
}

function OtpSetup({ onEnabled }: { onEnabled: () => Promise<void> }) {
  const { t } = useT();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const res = await api<{ secret: string; otpauthUrl: string }>('auth/otp/setup', { method: 'POST' });
      setSetup({ ...res, qr: await QRCode.toDataURL(res.otpauthUrl, { margin: 1, width: 200 }) });
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('auth/otp/enable', { body: { code } });
      await onEnabled();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <section className="card">
      <h2>{t('OTP 등록')}</h2>
      <p className="muted small-text">
        {t(
          '광고 등록, 주문, 코인 전달(릴리즈), 계좌 등록에는 OTP가 필요합니다. Google Authenticator 같은 인증 앱을 준비해 주세요.',
        )}
      </p>
      {!setup && <button onClick={start}>{t('OTP 등록 시작')}</button>}
      {setup && (
        <form onSubmit={enable}>
          <img src={setup.qr} alt={t('OTP 등록용 QR 코드')} width={200} height={200} />
          <p className="muted small-text">
            {t('QR을 찍을 수 없으면 아래 키를 인증 앱에 직접 입력하세요. 이 키는 다시 보여 주지 않습니다.')}
          </p>
          <code className="secret">{setup.secret}</code>
          <label htmlFor="otp-code">{t('인증 앱에 표시된 6자리 코드')}</label>
          <input id="otp-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="full">{t('OTP 사용 시작')}</button>
        </form>
      )}
      <ErrorText error={error} />
    </section>
  );
}

function PaymentMethods() {
  const { t, date } = useT();
  const [current, setCurrent] = useState<PaymentMethod | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [bankCode, setBankCode] = useState('004');
  const [holder, setHolder] = useState('');
  const [account, setAccount] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { paymentMethods } = await api<{ paymentMethods: PaymentMethod[] }>('payment-methods');
    setCurrent(paymentMethods[0] ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit() {
    if (current) {
      setBankCode(current.bankCode);
      setHolder(current.accountHolder);
    }
    setError(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fields = { bankCode, accountHolder: holder, accountNumber: account, otp };
      if (current) {
        await api(`payment-methods/${current.id}`, { method: 'PUT', body: fields });
      } else {
        await api('payment-methods', { body: { fiat: 'KRW', ...fields } });
      }
      setAccount('');
      setOtp('');
      setEditing(false);
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (current === undefined) return null;
  const showForm = !current || editing;

  return (
    <section className="card">
      <h2>{t('입금받을 계좌')}</h2>
      <p className="muted small-text">
        {t(
          '코인을 팔 때 구매자가 이 계좌로 입금합니다. 본인 명의 계좌 1개만 등록할 수 있고, 처음 등록한 계좌는 24시간 뒤부터 사용할 수 있습니다. 등록된 계좌를 변경하면 바로 사용할 수 있습니다.',
        )}
      </p>
      {current && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('은행')}</th>
                <th>{t('계좌')}</th>
                <th>{t('예금주')}</th>
                <th>{t('사용 가능')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t(BANKS[current.bankCode] ?? current.bankCode)}</td>
                <td>{current.accountMasked}</td>
                <td>{current.accountHolder}</td>
                <td>{new Date(current.usableFrom) <= new Date() ? t('가능') : date(current.usableFrom)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {current && !editing && (
        <p className="small-text">
          <button className="link-button" onClick={startEdit}>
            {t('계좌 변경')}
          </button>
        </p>
      )}
      {showForm && (
        <form onSubmit={save}>
          {current && (
            <p className="muted small-text">
              {t('진행 중인 내 광고는 새 계좌로 바뀌고, 이미 열린 주문은 원래 계좌로 입금받습니다.')}
            </p>
          )}
          <div className="grid2">
            <div>
              <label htmlFor="bank">{t('은행')}</label>
              <select id="bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                {Object.entries(BANKS).map(([code, name]) => (
                  <option key={code} value={code}>
                    {t(name)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="holder">{t('예금주 (본인 실명)')}</label>
              <input id="holder" value={holder} onChange={(e) => setHolder(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="account">{t(current ? '새 계좌번호' : '계좌번호')}</label>
              <input id="account" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="pm-otp">{t('OTP 코드')}</label>
              <input id="pm-otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} required />
            </div>
          </div>
          {current ? (
            <div className="row" style={{ marginTop: 16 }}>
              <button disabled={busy}>{t('계좌 변경')}</button>
              <button type="button" className="secondary" onClick={() => setEditing(false)}>
                {t('취소')}
              </button>
            </div>
          ) : (
            <button className="full" disabled={busy}>
              {t('계좌 등록')}
            </button>
          )}
        </form>
      )}
      <ErrorText error={error} />
    </section>
  );
}
