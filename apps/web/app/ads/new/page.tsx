'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BANKS } from '@/lib/messages';
import type { PaymentMethod } from '@/lib/types';
import { ASSETS, AssetCode, parseUnits } from '@/lib/units';
import { useMe } from '@/lib/use-me';

export default function NewAdPage() {
  const { me } = useMe();
  const router = useRouter();
  const { t } = useT();
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [asset, setAsset] = useState<AssetCode>('BTC');
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState('');
  const [min, setMin] = useState('10000');
  const [max, setMax] = useState('1000000');
  const [paymentWindow, setPaymentWindow] = useState(15);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodId, setMethodId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.otpEnabled) return;
    void api<{ paymentMethods: PaymentMethod[] }>('payment-methods').then((res) => {
      setMethods(res.paymentMethods);
      setMethodId(res.paymentMethods[0]?.id ?? '');
    });
  }, [me?.otpEnabled]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const totalAmount = parseUnits(total, ASSETS[asset].decimals);
    if (!/^\d+$/.test(price.replaceAll(',', '')) || !totalAmount) {
      setError(t('가격(원 단위 정수)과 수량을 확인해 주세요.'));
      return;
    }
    try {
      await api('ads', {
        body: {
          side,
          asset,
          fiat: 'KRW',
          priceMinor: price.replaceAll(',', ''),
          totalAmount: totalAmount.toString(),
          minOrderFiatMinor: min.replaceAll(',', ''),
          maxOrderFiatMinor: max.replaceAll(',', ''),
          paymentWindowMinutes: paymentWindow,
          paymentMethodId: side === 'sell' ? methodId || undefined : undefined,
        },
      });
      router.push('/');
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (me === undefined) return <p className="muted">{t('불러오는 중…')}</p>;
  if (!me?.otpEnabled) {
    return (
      <p className="notice">
        {t('광고를 올리려면 먼저 OTP를 등록해 주세요.')} <Link href="/account">{t('내 계정으로 가기')}</Link>
      </p>
    );
  }

  return (
    <div className="narrow" style={{ maxWidth: 560 }}>
      <h1>{t('광고 등록')}</h1>
      <form className="card" onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={side === 'sell' ? 'active sell' : ''} onClick={() => setSide('sell')}>
            {t('팔기 광고')}
          </button>
          <button type="button" className={side === 'buy' ? 'active buy' : ''} onClick={() => setSide('buy')}>
            {t('사기 광고')}
          </button>
        </div>
        <div className="grid2">
          <div>
            <label htmlFor="asset">{t('코인')}</label>
            <select id="asset" value={asset} onChange={(e) => setAsset(e.target.value as AssetCode)}>
              {Object.keys(ASSETS).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="price">{t('1 {asset} 가격 (원)', { asset })}</label>
            <input id="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="total">{t('총 수량 ({asset})', { asset })}</label>
            <input id="total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="window">{t('결제 기한 (분)')}</label>
            <input
              id="window"
              type="number"
              min={5}
              max={180}
              value={paymentWindow}
              onChange={(e) => setPaymentWindow(Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="min">{t('주문당 최소 (원)')}</label>
            <input id="min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="max">{t('주문당 최대 (원)')}</label>
            <input id="max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} required />
          </div>
        </div>
        {side === 'sell' && (
          <>
            <label htmlFor="pm">{t('입금받을 계좌')}</label>
            {methods.length ? (
              <select id="pm" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {t(BANKS[m.bankCode] ?? m.bankCode)} {m.accountMasked} ({m.accountHolder})
                  </option>
                ))}
              </select>
            ) : (
              <p className="muted small-text">
                {t('등록된 계좌가 없습니다.')} <Link href="/account">{t('내 계정에서 등록하기')}</Link>
              </p>
            )}
            <p className="muted small-text">{t('판매 수량만큼 지갑 잔고가 있어야 주문을 받을 수 있습니다.')}</p>
          </>
        )}
        <ErrorText error={error} />
        <button className="full">{t('광고 올리기')}</button>
      </form>
    </div>
  );
}
