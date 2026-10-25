'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import {
  BankIcon,
  CheckIcon,
  InfoIcon,
  KeyIcon,
  ResetIcon,
  ScaleIcon,
  SearchIcon,
  ShieldIcon,
  WalletIcon,
} from '@/components/icons';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BANKS } from '@/lib/messages';
import type { Ad, Me, Order, PaymentMethod } from '@/lib/types';
import { ASSETS, AssetCode, fiatFor, formatKrw, formatRate, formatUnits, orderCost, parseUnits } from '@/lib/units';
import { useMe } from '@/lib/use-me';

type Mode = 'buy' | 'sell';
type Sort = 'price' | 'limit' | 'amount';

export default function MarketPage() {
  const { me } = useMe();
  return (
    <>
      {me === null && <Hero />}
      <Market />
      {me === null && <HowItWorks />}
    </>
  );
}

function Hero() {
  const { t } = useT();
  return (
    <section className="hero">
      <div>
        <p className="eyebrow lined">Direct trade · Safe escrow</p>
        <h1>
          {t('사람과 직접 거래하고,')}
          <span className="accent">{t('코인은 에스크로가 지킵니다.')}</span>
        </h1>
        <p className="hero-lead">
          {t('원하는 가격의 광고를 고르고 원화 계좌이체로 결제하세요. 판매자가 입금을 확인하기 전까지 코인은 에스크로에 안전하게 잠겨 있습니다.')}
        </p>
        <div className="hero-cta">
          <Link href="/signup" className="button large">
            {t('지금 시작하기')}
          </Link>
          <a href="#market" className="button secondary large">
            {t('마켓 둘러보기')}
          </a>
        </div>
        <ul className="feature-badges">
          <li>
            <ShieldIcon />
            {t('에스크로 보호')}
          </li>
          <li>
            <BankIcon />
            {t('원화 계좌이체')}
          </li>
          <li>
            <KeyIcon />
            {t('OTP 2단계 인증')}
          </li>
          <li>
            <ScaleIcon />
            {t('분쟁 시 운영팀 조정')}
          </li>
        </ul>
      </div>
      <div>
        <div className="hero-art">
          <HeroArt />
          <div className="hero-chip escrow float slow">
            <span className="chip-icon">
              <KeyIcon />
            </span>
            <span>
              {t('에스크로 잠금')}
              <small>{t('판매자 입금 확인 대기')}</small>
            </span>
          </div>
          <div className="hero-chip done float">
            <span className="chip-icon">
              <CheckIcon />
            </span>
            <span>
              {t('거래 완료')}
              <small>0.0100 BTC</small>
            </span>
          </div>
        </div>
        <p className="hero-caption">DIRECT · SAFE · PEER TO PEER</p>
      </div>
    </section>
  );
}

/** Two coins on an orbit: a coin and won changing hands. */
function HeroArt() {
  return (
    <svg viewBox="0 0 460 400" aria-hidden="true">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="coinA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6d27a" />
          <stop offset="100%" stopColor="#c9952a" />
        </linearGradient>
        <linearGradient id="coinB" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#13906b" />
          <stop offset="100%" stopColor="#064a37" />
        </linearGradient>
        <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#0b4a37" floodOpacity="0.25" />
        </filter>
      </defs>
      <ellipse cx="230" cy="200" rx="210" ry="170" fill="url(#glow)" />
      <ellipse className="orbit" cx="230" cy="200" rx="200" ry="118" transform="rotate(-20 230 200)" />
      <ellipse className="orbit dashed" cx="230" cy="200" rx="160" ry="150" transform="rotate(14 230 200)" />
      <circle cx="58" cy="262" r="5" fill="var(--accent)" opacity="0.5" />
      <circle cx="402" cy="128" r="4" fill="var(--gold)" opacity="0.7" />
      <circle cx="300" cy="60" r="3" fill="var(--accent)" opacity="0.4" />
      <g className="float">
        <circle cx="140" cy="132" r="62" fill="var(--surface)" filter="url(#shadow)" />
        <circle cx="140" cy="132" r="50" fill="url(#coinA)" />
        <circle cx="140" cy="132" r="42" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="2" />
        <text x="140" y="150" textAnchor="middle" fontSize="50" fontWeight="800" fill="#fff">
          ₿
        </text>
      </g>
      <g className="float slow">
        <circle cx="330" cy="272" r="60" fill="var(--surface)" filter="url(#shadow)" />
        <circle cx="330" cy="272" r="50" fill="url(#coinB)" />
        <circle cx="330" cy="272" r="42" fill="none" stroke="#fff" strokeOpacity="0.3" strokeWidth="2" />
        <text x="330" y="290" textAnchor="middle" fontSize="48" fontWeight="800" fill="#fff">
          ₩
        </text>
      </g>
      <g stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.75">
        <path d="M208 190h46l-12-12" />
        <path d="M252 214h-46l12 12" />
      </g>
    </svg>
  );
}

function HowItWorks() {
  const { t } = useT();
  return (
    <section className="section" id="how">
      <p className="eyebrow">How it works</p>
      <div className="section-head">
        <h2>{t('이용 방법')}</h2>
      </div>
      <div className="steps">
        <article className="card step">
          <div className="step-icon">
            <SearchIcon />
          </div>
          <h3>{t('광고 고르기')}</h3>
          <p>{t('코인과 가격, 거래 한도를 비교해 마음에 드는 광고를 고릅니다.')}</p>
        </article>
        <article className="card step">
          <div className="step-icon">
            <BankIcon />
          </div>
          <h3>{t('계좌이체로 결제')}</h3>
          <p>{t('주문하면 판매자의 코인이 에스크로에 잠깁니다. 안내된 계좌로 원화를 이체하세요.')}</p>
        </article>
        <article className="card step">
          <div className="step-icon">
            <WalletIcon />
          </div>
          <h3>{t('코인 받기')}</h3>
          <p>{t('판매자가 입금을 확인하면 에스크로의 코인이 내 지갑으로 들어옵니다.')}</p>
        </article>
      </div>
      <div className="cta-band">
        <div>
          <h2>{t('지금 가입하고 첫 거래를 시작하세요')}</h2>
          <p>{t('가입 후 본인인증과 OTP 등록을 마치면 바로 거래할 수 있습니다.')}</p>
        </div>
        <div className="row">
          <Link href="/signup" className="button large">
            {t('가입하기')}
          </Link>
          <Link href="/login" className="button large ghost">
            {t('로그인')}
          </Link>
        </div>
      </div>
    </section>
  );
}

function Market() {
  const { me } = useMe();
  const { t, locale } = useT();
  const [mode, setMode] = useState<Mode>('buy');
  const [asset, setAsset] = useState<AssetCode>('BTC');
  const [amount, setAmount] = useState('');
  const [sort, setSort] = useState<Sort>('price');
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
  const digits = amount.replace(/[,\s]/g, '');
  const wanted = /^\d+$/.test(digits) && BigInt(digits) > 0n ? BigInt(digits) : null;

  const shown = useMemo(() => {
    if (!ads) return null;
    const price = (ad: Ad) => BigInt(ad.finalPriceMinor ?? ad.priceMinor);
    const list = ads.filter((ad) => {
      if (wanted === null) return true;
      const available = fiatFor(BigInt(ad.remainingAmount), price(ad), decimals);
      return BigInt(ad.minOrderFiatMinor) <= wanted && wanted <= BigInt(ad.maxOrderFiatMinor) && wanted <= available;
    });
    const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
    return list.sort((a, b) => {
      if (sort === 'limit') return cmp(BigInt(b.maxOrderFiatMinor), BigInt(a.maxOrderFiatMinor));
      if (sort === 'amount') return cmp(BigInt(b.remainingAmount), BigInt(a.remainingAmount));
      // Buyers want the lowest price, sellers the highest.
      return mode === 'buy' ? cmp(price(a), price(b)) : cmp(price(b), price(a));
    });
  }, [ads, wanted, sort, mode, decimals]);

  function reset() {
    setAmount('');
    setSort('price');
  }

  return (
    <section className="section" id="market">
      <p className="eyebrow">Marketplace</p>
      <div className="section-head">
        <h2>{t('나에게 맞는 거래 찾기')}</h2>
        <span className="live-dot">{t('원화(KRW) · 은행 계좌이체')}</span>
      </div>

      <div className="card market">
        <div className="market-top">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'buy'} className={mode === 'buy' ? 'active buy' : ''} onClick={() => setMode('buy')}>
              {t('구매하기')}
            </button>
            <button role="tab" aria-selected={mode === 'sell'} className={mode === 'sell' ? 'active sell' : ''} onClick={() => setMode('sell')}>
              {t('판매하기')}
            </button>
          </div>
          <span className="market-hint">
            {t(mode === 'buy' ? '원화로 {asset} 사기' : '{asset} 팔고 원화 받기', { asset })}
          </span>
        </div>

        <div className="market-filters">
          <div>
            <label htmlFor="market-asset">{t('코인')}</label>
            <select id="market-asset" value={asset} onChange={(e) => setAsset(e.target.value as AssetCode)}>
              {Object.keys(ASSETS).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="market-amount">{t('거래 금액')}</label>
            <div className="input-suffix">
              <input
                id="market-amount"
                inputMode="numeric"
                placeholder={t('금액 입력')}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span>KRW</span>
            </div>
          </div>
          <div>
            <label htmlFor="market-sort">{t('정렬 기준')}</label>
            <select id="market-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="price">{t('유리한 가격순')}</option>
              <option value="limit">{t('한도 높은순')}</option>
              <option value="amount">{t('수량 많은순')}</option>
            </select>
          </div>
          <button type="button" className="link-button reset-button" onClick={reset}>
            <ResetIcon size={14} />
            {t('초기화')}
          </button>
        </div>

        <div className="market-meta">
          <span>
            {t('거래 가능한 광고')}
            <strong>{shown?.length ?? 0}</strong>
          </span>
          <span>{t('가격은 수수료가 포함된 금액입니다')}</span>
        </div>

        <div className="market-head" aria-hidden="true">
          <span>{t('광고주')}</span>
          <span>
            {t('가격')}
            <span className="unit">KRW</span>
          </span>
          <span>{t('거래 가능 수량 / 한도')}</span>
          <span>{t('거래 조건')}</span>
          <span />
        </div>

        {error && (
          <div style={{ padding: '0 24px 16px' }}>
            <ErrorText error={error} />
          </div>
        )}
        {shown === null && !error && <div className="empty">{t('불러오는 중…')}</div>}
        {shown?.length === 0 && (
          <div className="empty">
            <span className="empty-icon">
              <SearchIcon />
            </span>
            <strong>{t(ads?.length ? '조건에 맞는 광고가 없습니다' : '지금 올라온 광고가 없습니다.')}</strong>
            <p>{t(ads?.length ? '거래 금액이나 코인을 바꿔 보세요.' : '다른 코인을 고르거나 직접 광고를 올려 보세요.')}</p>
            {wanted !== null ? (
              <button type="button" className="secondary small" onClick={() => setAmount('')}>
                {t('금액 필터 지우기')}
              </button>
            ) : (
              me && (
                <Link href="/ads/new" className="button secondary small">
                  {t('광고 등록')}
                </Link>
              )
            )}
          </div>
        )}
        <div className="market-list">
          {shown?.map((ad) => {
            const name = ad.makerNickname ?? '-';
            const mine = me?.id === ad.makerId;
            return (
              <div key={ad.id}>
                <div className="market-row">
                  <div className="maker">
                    <span className="avatar">{[...name][0]?.toUpperCase()}</span>
                    <div>
                      <strong>{name}</strong>
                      <span className="muted">{mine ? t('내 광고') : t(ad.side === 'sell' ? '판매 광고' : '구매 광고')}</span>
                    </div>
                  </div>
                  <div>
                    <span className="cell-label">{t('가격')}</span>
                    <div className="price">{formatKrw(ad.finalPriceMinor ?? ad.priceMinor, locale)}</div>
                    <div className="muted small-text">
                      {t('1 {asset} 가격', { asset: ad.asset })}
                      {ad.feeRateBp ? <> · {t('수수료 {rate} 포함', { rate: formatRate(ad.feeRateBp) })}</> : null}
                    </div>
                  </div>
                  <div className="small-text">
                    <span className="cell-label">{t('거래 가능 수량 / 한도')}</span>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {formatUnits(ad.remainingAmount, decimals)} {ad.asset}
                    </div>
                    <div className="muted">
                      {t('한도 {min} ~ {max}', {
                        min: formatKrw(ad.minOrderFiatMinor, locale),
                        max: formatKrw(ad.maxOrderFiatMinor, locale),
                      })}
                    </div>
                  </div>
                  <div>
                    <span className="cell-label">{t('거래 조건')}</span>
                    <div className="terms">
                      <span className="tag accent">{t('은행 이체')}</span>
                      <span className="tag">{t('결제 기한 {n}분', { n: ad.paymentWindowMinutes })}</span>
                    </div>
                  </div>
                  <div className="action">
                    {me ? (
                      !mine && (
                        <button
                          className={`small ${mode === 'sell' ? 'danger' : 'buy-button'}`}
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
            );
          })}
        </div>

        <div className="market-foot">
          <InfoIcon />
          <span>
            {t(
              '이용자끼리 원화 계좌이체로 코인을 사고팝니다. 거래 중인 코인은 에스크로에 잠겨 있다가, 판매자가 입금을 확인한 뒤에만 구매자에게 넘어갑니다.',
            )}
          </span>
        </div>
      </div>
    </section>
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
  const cost = units ? orderCost(units, BigInt(ad.priceMinor), ad.feeRateBp ?? 0, decimals) : null;

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
      <div className="order-panel">
        <p className="notice">
          {t('거래하려면 먼저 OTP를 등록해 주세요.')} <Link href="/account">{t('내 계정으로 가기')}</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="order-panel" onSubmit={submit}>
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
