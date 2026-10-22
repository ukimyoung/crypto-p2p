'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { BANKS } from '@/lib/messages';
import type { PaymentMethod } from '@/lib/types';
import { useMe } from '@/lib/use-me';

export default function AccountPage() {
  const { me, reload } = useMe();

  if (me === undefined) return <p className="muted">불러오는 중…</p>;
  if (me === null) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return null;
  }

  return (
    <>
      <h1>내 계정</h1>
      <section className="card">
        <h2>기본 정보</h2>
        <dl className="kv">
          <dt>이메일</dt>
          <dd>{me.email}</dd>
          <dt>본인인증(KYC)</dt>
          <dd>{me.kycLevel > 0 ? `${me.kycLevel}단계 완료` : '미완료'}</dd>
          <dt>OTP</dt>
          <dd>{me.otpEnabled ? '사용 중' : '미등록'}</dd>
        </dl>
        {me.kycLevel === 0 && (
          <p className="notice" style={{ marginTop: 16, marginBottom: 0 }}>
            본인인증 기능은 준비 중입니다. 인증을 마쳐야 주문을 하고 입금 계좌를 등록할 수 있습니다.
          </p>
        )}
      </section>
      {!me.otpEnabled && <OtpSetup onEnabled={reload} />}
      {me.otpEnabled && <PaymentMethods />}
    </>
  );
}

function OtpSetup({ onEnabled }: { onEnabled: () => Promise<void> }) {
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
      <h2>OTP 등록</h2>
      <p className="muted small-text">
        광고 등록, 주문, 코인 전달(릴리즈), 계좌 등록에는 OTP가 필요합니다. Google Authenticator 같은 인증 앱을
        준비해 주세요.
      </p>
      {!setup && <button onClick={start}>OTP 등록 시작</button>}
      {setup && (
        <form onSubmit={enable}>
          <img src={setup.qr} alt="OTP 등록용 QR 코드" width={200} height={200} />
          <p className="muted small-text">QR을 찍을 수 없으면 아래 키를 인증 앱에 직접 입력하세요. 이 키는 다시 보여 주지 않습니다.</p>
          <code className="secret">{setup.secret}</code>
          <label htmlFor="otp-code">인증 앱에 표시된 6자리 코드</label>
          <input id="otp-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="full">OTP 사용 시작</button>
        </form>
      )}
      <ErrorText error={error} />
    </section>
  );
}

function PaymentMethods() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [bankCode, setBankCode] = useState('004');
  const [holder, setHolder] = useState('');
  const [account, setAccount] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMethods((await api<{ paymentMethods: PaymentMethod[] }>('payment-methods')).paymentMethods);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('payment-methods', {
        body: { fiat: 'KRW', bankCode, accountHolder: holder, accountNumber: account, otp },
      });
      setAccount('');
      setOtp('');
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <section className="card">
      <h2>입금받을 계좌</h2>
      <p className="muted small-text">
        코인을 팔 때 구매자가 이 계좌로 입금합니다. 본인 명의 계좌만 등록할 수 있고, 새 계좌는 등록 24시간 뒤부터
        사용할 수 있습니다.
      </p>
      {methods.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>은행</th>
                <th>계좌</th>
                <th>예금주</th>
                <th>사용 가능</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.id}>
                  <td>{BANKS[m.bankCode] ?? m.bankCode}</td>
                  <td>{m.accountMasked}</td>
                  <td>{m.accountHolder}</td>
                  <td>{new Date(m.usableFrom) <= new Date() ? '가능' : new Date(m.usableFrom).toLocaleString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={add}>
        <div className="grid2">
          <div>
            <label htmlFor="bank">은행</label>
            <select id="bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
              {Object.entries(BANKS).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="holder">예금주 (본인 실명)</label>
            <input id="holder" value={holder} onChange={(e) => setHolder(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="account">계좌번호</label>
            <input id="account" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="pm-otp">OTP 코드</label>
            <input id="pm-otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} required />
          </div>
        </div>
        <button className="full">계좌 등록</button>
      </form>
      <ErrorText error={error} />
    </section>
  );
}
