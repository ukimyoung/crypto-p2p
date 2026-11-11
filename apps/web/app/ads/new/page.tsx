'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BANKS } from '@/lib/messages';
import type { PaymentMethod } from '@/lib/types';
import { ASSET_CODES, ASSETS, DEFAULT_ASSET, AssetCode, feeOn, formatKrw, formatRate, orderCost, parseUnits } from '@/lib/units';
import { useMe } from '@/lib/use-me';

type Side = 'sell' | 'buy';

interface AdForm {
  asset: AssetCode;
  price: string;
  total: string;
  min: string;
  max: string;
  paymentWindow: number;
}

/** Ad terms as `GET /ads/terms` returns them. The server keeps the only copy of the wording. */
interface AdTerms {
  version: string;
  locale: 'ko' | 'en';
  title: string;
  clauses: { heading: string; body: string }[];
  agreement: string;
  hash: string;
}

const INITIAL_FORM: AdForm = { asset: DEFAULT_ASSET, price: '', total: '', min: '10000', max: '1000000', paymentWindow: 15 };

export default function NewAdPage() {
  const { me } = useMe();
  const router = useRouter();
  const { t, locale } = useT();
  const [side, setSide] = useState<Side>('sell');
  // Each tab keeps its own values, so switching tabs neither copies nor loses what was typed.
  const [forms, setForms] = useState<Record<Side, AdForm>>({ sell: INITIAL_FORM, buy: INITIAL_FORM });
  const { asset, price, total, min, max, paymentWindow } = forms[side];
  function setField<K extends keyof AdForm>(key: K, value: AdForm[K]) {
    setForms((prev) => ({ ...prev, [side]: { ...prev[side], [key]: value } }));
  }
  const setAsset = (value: AssetCode) => setField('asset', value);
  const setPrice = (value: string) => setField('price', value);
  const setTotal = (value: string) => setField('total', value);
  const setMin = (value: string) => setField('min', value);
  const setMax = (value: string) => setField('max', value);
  const setPaymentWindow = (value: number) => setField('paymentWindow', value);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodId, setMethodId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feeRateBp, setFeeRateBp] = useState<number | null>(null);
  const [terms, setTerms] = useState<AdTerms | null>(null);
  const [termsError, setTermsError] = useState(false);
  // Agreement is per tab and per ad: posting or switching language starts with the box unticked.
  const [agreed, setAgreed] = useState<Record<Side, boolean>>({ sell: false, buy: false });
  const [termsReload, setTermsReload] = useState(0);

  useEffect(() => {
    let current = true;
    setTerms(null);
    setTermsError(false);
    api<{ terms: AdTerms }>(`ads/terms?side=${side}&locale=${locale}`)
      .then((res) => current && setTerms(res.terms))
      .catch(() => current && setTermsError(true));
    return () => {
      current = false;
    };
  }, [side, locale, termsReload]);

  useEffect(() => {
    setAgreed({ sell: false, buy: false });
  }, [locale]);

  useEffect(() => {
    setFeeRateBp(null);
    void api<{ feeRateBp: number }>(`ads/fee-rate?asset=${asset}&fiat=KRW`).then((res) => setFeeRateBp(res.feeRateBp));
  }, [asset]);

  const priceInput = price.replaceAll(',', '');
  const finalPrice =
    feeRateBp !== null && /^\d+$/.test(priceInput) && BigInt(priceInput) > 0n
      ? BigInt(priceInput) + feeOn(BigInt(priceInput), feeRateBp)
      : null;

  const totalUnits = parseUnits(total, ASSETS[asset].decimals);
  const maxWithFee =
    feeRateBp !== null && /^\d+$/.test(priceInput) && BigInt(priceInput) > 0n && totalUnits
      ? orderCost(totalUnits, BigInt(priceInput), feeRateBp, ASSETS[asset].decimals)
      : null;

  useEffect(() => {
    if (!me || me.kycLevel < 1) return;
    void api<{ paymentMethods: PaymentMethod[] }>('payment-methods').then((res) => {
      setMethods(res.paymentMethods);
      setMethodId(res.paymentMethods[0]?.id ?? '');
    });
  }, [me?.kycLevel]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const totalAmount = parseUnits(total, ASSETS[asset].decimals);
    if (!terms || !agreed[side]) {
      setError(t('서비스 이용 동의에 체크해 주세요.'));
      return;
    }
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
          agreement: { agreed: true, termsVersion: terms.version, termsHash: terms.hash, locale: terms.locale },
        },
      });
      router.push('/market');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'terms_outdated') {
        // The wording changed while the form was open: show the new text and ask again.
        setAgreed((prev) => ({ ...prev, [side]: false }));
        setTermsReload((n) => n + 1);
      }
      setError(messageOf(err));
    }
  }

  if (me === undefined) return <p className="muted">{t('불러오는 중…')}</p>;
  if (!me || me.kycLevel < 1) {
    return (
      <p className="notice">
        {t('광고를 올리려면 먼저 본인인증을 해 주세요.')} <Link href="/account/verify">{t('본인 인증하기')}</Link>
      </p>
    );
  }

  return (
    <>
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
              {ASSET_CODES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="price">{t('1 {asset} 가격 (원)', { asset })}</label>
            <input id="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          {feeRateBp !== null && (
            <p className="muted small-text" style={{ gridColumn: '1 / -1', margin: 0 }}>
              {t(
                side === 'sell'
                  ? '광고 수수료 {rate}가 가격에 더해져 구매자에게 보입니다. 수수료는 거래가 끝난 뒤 원화로 청구됩니다.'
                  : '광고 수수료 {rate}가 가격에 더해집니다. 판매자에게는 수수료를 더한 금액을 이체하고, 수수료는 거래가 끝난 뒤 원화로 청구됩니다.',
                { rate: formatRate(feeRateBp) },
              )}
              {finalPrice !== null && (
                <>
                  {' '}
                  <strong>
                    {t(side === 'sell' ? '최종 광고 가격 {price}' : '수수료 포함 실제 입금 가격 {price}', {
                      price: formatKrw(finalPrice, locale),
                    })}
                  </strong>
                </>
              )}
            </p>
          )}
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
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} required />
              <button
                type="button"
                className="secondary small"
                style={{ whiteSpace: 'nowrap' }}
                disabled={maxWithFee === null}
                title={maxWithFee === null ? t('가격과 총 수량을 먼저 입력해 주세요.') : undefined}
                onClick={() => maxWithFee !== null && setMax(maxWithFee.toString())}
              >
                {t('최대(수수료포함)')}
              </button>
            </div>
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
        <section className="ad-terms" aria-labelledby="ad-terms-title">
          {terms ? (
            <>
              <h2 id="ad-terms-title">{terms.title}</h2>
              <ol className="ad-terms-body" tabIndex={0} aria-label={terms.title}>
                {terms.clauses.map((clause) => (
                  <li key={clause.heading}>
                    <strong>{clause.heading}</strong>
                    <p>{clause.body}</p>
                  </li>
                ))}
              </ol>
              <label className="ad-terms-agree">
                <input
                  type="checkbox"
                  checked={agreed[side]}
                  onChange={(e) => setAgreed((prev) => ({ ...prev, [side]: e.target.checked }))}
                />
                <span>
                  {terms.agreement} <span className="ad-terms-required">{t('(필수)')}</span>
                </span>
              </label>
            </>
          ) : termsError ? (
            <p className="muted small-text">
              {t('이용 동의 내용을 불러오지 못했습니다.')}{' '}
              <button type="button" className="link-button" onClick={() => setTermsReload((n) => n + 1)}>
                {t('다시 시도')}
              </button>
            </p>
          ) : (
            <p className="muted small-text">{t('불러오는 중…')}</p>
          )}
        </section>
        <ErrorText error={error} />
        <button
          className="full"
          disabled={!terms || !agreed[side]}
          title={!agreed[side] ? t('서비스 이용 동의에 체크해야 광고를 올릴 수 있습니다.') : undefined}
        >
          {t('광고 올리기')}
        </button>
      </form>
    </>
  );
}
