'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BANKS } from '@/lib/messages';
import type { Ad, Me, Order, PaymentMethod } from '@/lib/types';
import { ASSETS, AssetCode, fiatFor, formatKrw, formatUnits, parseUnits } from '@/lib/units';
import { useMe } from '@/lib/use-me';

type Mode = 'buy' | 'sell';

export default function MarketPage() {
  const { me } = useMe();
  const { t, locale } = useT();
  const [mode, setMode] = useState<Mode>('buy');
  const [asset, setAsset] = useState<AssetCode>('BTC');
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openAd, setOpenAd] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // To buy coins you take a sell ad, and the other way round.
      const side = mode === 'buy' ? 'sell' : 'buy';
      const res = await api<{ ads: Ad[] }>(`ads?asset=${asset}&fiat=KRW&side=${side}`);
      setAds(res.ads);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [mode, asset]);

  useEffect(() => {
    setAds(null);
    setOpenAd(null);
    void load();
  }, [load]);

  const decimals = ASSETS[asset].decimals;

  return (
    <>
      <h1>{t('P2P 마켓')}</h1>
      <p className="muted">
        {t(
          '이용자끼리 원화 계좌이체로 코인을 사고팝니다. 거래 중인 코인은 에스크로에 잠겨 있다가, 판매자가 입금을 확인한 뒤에만 구매자에게 넘어갑니다.',
        )}
      </p>
      <div className="row" style={{ margin: '16px 0' }}>
        <div className="tabs">
          <button className={mode === 'buy' ? 'active buy' : ''} onClick={() => setMode('buy')}>
            {t('사기')}
          </button>
          <button className={mode === 'sell' ? 'active sell' : ''} onClick={() => setMode('sell')}>
            {t('팔기')}
          </button>
        </div>
        <select value={asset} onChange={(e) => setAsset(e.target.value as AssetCode)} style={{ width: 'auto' }} aria-label={t('코인')}>
          {Object.keys(ASSETS).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <span className="muted small-text">{t('원화(KRW) · 은행 계좌이체')}</span>
      </div>

      <section className="card">
        <ErrorText error={error} />
        {ads === null && !error && <p className="muted">{t('불러오는 중…')}</p>}
        {ads?.length === 0 && <p className="muted">{t('지금 올라온 광고가 없습니다.')}</p>}
        {ads?.map((ad) => (
          <div key={ad.id}>
            <div className="ad">
              <div>
                <div className="price">{formatKrw(ad.priceMinor, locale)}</div>
                <div className="muted small-text">{t('1 {asset} 가격', { asset: ad.asset })}</div>
              </div>
              <div className="small-text">
                <div>
                  {t('수량 {amount} {asset}', { amount: formatUnits(ad.remainingAmount, decimals), asset: ad.asset })}
                </div>
                <div className="muted">
                  {t('한도 {min} ~ {max}', {
                    min: formatKrw(ad.minOrderFiatMinor, locale),
                    max: formatKrw(ad.maxOrderFiatMinor, locale),
                  })}
                </div>
              </div>
              <div className="small-text muted">{t('결제 기한 {n}분', { n: ad.paymentWindowMinutes })}</div>
              <div>
                {me ? (
                  me.id !== ad.makerId && (
                    <button
                      className={`small ${mode === 'sell' ? 'danger' : ''}`}
                      onClick={() => setOpenAd(openAd === ad.id ? null : ad.id)}
                    >
                      {t(mode === 'buy' ? '{asset} 사기' : '{asset} 팔기', { asset: ad.asset })}
                    </button>
                  )
                ) : (
                  <Link href="/login" className="button small">
                    {t('로그인 후 거래')}
                  </Link>
                )}
              </div>
            </div>
            {openAd === ad.id && me && <OrderForm ad={ad} mode={mode} me={me} />}
          </div>
        ))}
      </section>
    </>
  );
}

function OrderForm({ ad, mode, me }: { ad: Ad; mode: Mode; me: Me }) {
  const router = useRouter();
  const { t, locale } = useT();
  const decimals = ASSETS[ad.asset as AssetCode].decimals;
  const [amount, setAmount] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodId, setMethodId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'sell' || !me.otpEnabled) return;
    void api<{ paymentMethods: PaymentMethod[] }>('payment-methods').then((res) => {
      setMethods(res.paymentMethods);
      setMethodId(res.paymentMethods[0]?.id ?? '');
    });
  }, [mode, me.otpEnabled]);

  const units = parseUnits(amount, decimals);
  const cost = units ? fiatFor(units, BigInt(ad.priceMinor), decimals) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!units) {
      setError(t('수량을 확인해 주세요. 소수점은 {n}자리까지 됩니다.', { n: decimals }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ order: Order }>('orders', {
        body: { adId: ad.id, amount: units.toString(), paymentMethodId: mode === 'sell' ? methodId : undefined },
      });
      router.push(`/orders/${res.order.id}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  if (!me.otpEnabled) {
    return (
      <p className="notice">
        {t('거래하려면 먼저 OTP를 등록해 주세요.')} <Link href="/account">{t('내 계정으로 가기')}</Link>
      </p>
    );
  }

  return (
    <form className="card" style={{ background: 'var(--bg)' }} onSubmit={submit}>
      <div className="grid2">
        <div>
          <label htmlFor={`amount-${ad.id}`}>
            {t(mode === 'buy' ? '살 수량 ({asset})' : '팔 수량 ({asset})', { asset: ad.asset })}
          </label>
          <input
            id={`amount-${ad.id}`}
            inputMode="decimal"
            placeholder="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label>{t(mode === 'buy' ? '보낼 금액' : '받을 금액')}</label>
          <div className="price" style={{ paddingTop: 6 }}>
            {cost !== null ? formatKrw(cost, locale) : '-'}
          </div>
        </div>
      </div>
      {mode === 'sell' && (
        <>
          <label htmlFor={`pm-${ad.id}`}>{t('입금받을 내 계좌')}</label>
          {methods.length ? (
            <select id={`pm-${ad.id}`} value={methodId} onChange={(e) => setMethodId(e.target.value)}>
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
        </>
      )}
      <p className="muted small-text">
        {mode === 'buy'
          ? t(
              "주문하면 판매자의 코인이 에스크로에 잠깁니다. {n}분 안에 판매자 계좌로 이체하고 '이체 완료'를 눌러 주세요.",
              { n: ad.paymentWindowMinutes },
            )
          : t('주문하면 내 코인이 에스크로에 잠깁니다. 구매자의 입금을 계좌에서 직접 확인한 뒤에만 코인을 넘겨 주세요.')}
      </p>
      <ErrorText error={error} />
      <button className="full" disabled={busy}>
        {t('주문하기')}
      </button>
    </form>
  );
}
