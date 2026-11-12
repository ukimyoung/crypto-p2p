'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import type { LivePrice, ReferencePrice, ReferencePriceOverview } from '@/lib/types';
import { formatKrw } from '@/lib/units';
import { withStepUp } from '@/lib/use-operator';

/** "1,380" or "1380" won -> "1380". Null unless it is a whole number above zero. */
export function parseWon(input: string): string | null {
  const s = input.trim().replace(/,/g, '').replace(/원$/, '').trim();
  if (!/^\d{1,15}$/.test(s)) return null;
  const v = BigInt(s);
  return v > 0n ? v.toString() : null;
}

const priceText = (p: Pick<ReferencePrice, 'fiat' | 'priceMinor'>) =>
  p.fiat === 'KRW' ? formatKrw(p.priceMinor) : `${BigInt(p.priceMinor).toLocaleString('ko-KR')} ${p.fiat}`;

/** The USDT, BTC and ETH prices in won that operators set by hand, with who changed them and when. */
export function ReferencePrices() {
  const [markets, setMarkets] = useState<ReferencePriceOverview[] | null>(null);

  const load = useCallback(async () => {
    setMarkets((await api<{ prices: ReferencePriceOverview[] }>('ops/settings/reference-prices')).prices);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!markets) return <p className="muted">불러오는 중…</p>;

  return (
    <>
      <p className="muted small-text">
        운영자가 직접 정하는 코인 1개의 원화 시세입니다. &lsquo;실시간 시세 가져오기&rsquo;를 누르면 업비트(실패하면
        빗썸)의 최근 체결가를 입력칸에 채웁니다. 저장하면 바로 지금 시세가 되고, 이전 값은 변경 이력과 감사 로그에
        남습니다. 지금은 기록·참고용이며 광고 가격이나 주문 금액에는 쓰이지 않습니다.
      </p>
      {markets.map((m) => (
        <MarketPrice key={`${m.asset}/${m.fiat}`} market={m} onSaved={load} />
      ))}
    </>
  );
}

function MarketPrice({ market, onSaved }: { market: ReferencePriceOverview; onSaved: () => Promise<void> }) {
  const id = `${market.asset}-${market.fiat}`.toLowerCase();
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [live, setLive] = useState<LivePrice | null>(null);
  const [fetching, setFetching] = useState(false);

  async function fetchLive() {
    setError(null);
    setSaved(false);
    setFetching(true);
    try {
      const q = new URLSearchParams({ asset: market.asset, fiat: market.fiat });
      const res = await api<{ price: LivePrice }>(`ops/settings/reference-prices/live?${q}`);
      setLive(res.price);
      setPrice(BigInt(res.price.priceMinor).toLocaleString('ko-KR'));
    } catch (err) {
      setLive(null);
      setError(messageOf(err));
    } finally {
      setFetching(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const priceMinor = parseWon(price);
    if (priceMinor === null) {
      setError('시세는 0보다 큰 원 단위 정수로 입력해 주세요. (예: 1,380)');
      return;
    }
    try {
      const body = { asset: market.asset, fiat: market.fiat, priceMinor, reason };
      if (!(await withStepUp(() => api('ops/settings/reference-prices', { body })))) return;
      setPrice('');
      setReason('');
      setLive(null);
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <div className="reference-price">
      <h3>{market.asset}</h3>
      <dl className="kv">
        <dt>지금 시세</dt>
        <dd>
          {market.current ? (
            <strong>
              1 {market.asset} = {priceText(market.current)}
            </strong>
          ) : (
            <span className="muted">아직 설정하지 않았습니다</span>
          )}
        </dd>
        {market.current && (
          <>
            <dt>마지막 변경</dt>
            <dd>
              {new Date(market.current.createdAt).toLocaleString('ko-KR')} · {market.current.createdByEmail ?? '시스템'}
            </dd>
          </>
        )}
      </dl>

      <form onSubmit={save} className="settings-form">
        <h3>{market.asset} 시세 바꾸기</h3>
        <label htmlFor={`${id}-price`}>
          1 {market.asset} 시세 ({market.fiat === 'KRW' ? '원' : market.fiat})
        </label>
        <div className="price-input-row">
          <input
            id={`${id}-price`}
            inputMode="numeric"
            placeholder={market.asset === 'USDT' ? '1,380' : ''}
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setLive(null);
            }}
            required
          />
          <button type="button" className="secondary" onClick={fetchLive} disabled={fetching}>
            {fetching ? '가져오는 중…' : '실시간 시세 가져오기'}
          </button>
        </div>
        {live && (
          <p className="muted small-text">
            {live.source === 'Upbit' ? '업비트' : live.source === 'Bithumb' ? '빗썸' : live.source} 최근 체결가 (
            {new Date(live.tradedAt).toLocaleString('ko-KR')})를 채웠습니다. 확인한 뒤 저장해 주세요.
          </p>
        )}
        <label htmlFor={`${id}-reason`}>변경 사유 (감사 로그에 남습니다)</label>
        <input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} required />
        <button>시세 저장 (OTP 확인)</button>
        {saved && <p className="muted small-text">저장했습니다.</p>}
        <ErrorText error={error} />
      </form>

      {market.history.length > 0 && (
        <>
          <h3>변경 이력</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>변경 시각</th>
                  <th>시세</th>
                  <th>사유</th>
                  <th>처리자</th>
                </tr>
              </thead>
              <tbody>
                {market.history.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.createdAt).toLocaleString('ko-KR')}</td>
                    <td>{priceText(p)}</td>
                    <td>{p.reason}</td>
                    <td className="muted">{p.createdByEmail ?? '시스템'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
