'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import type { BillingSettings, FeeRateChange, FeeRateOverview } from '@/lib/types';
import { formatRate, parseRate } from '@/lib/units';
import { withStepUp } from '@/lib/use-operator';

const DEFAULT = 'default';
const label = (c: Pick<FeeRateChange, 'asset' | 'fiat'>) => (c.asset ? `${c.asset}/${c.fiat}` : '기본 요율');
const rateText = (c: FeeRateChange) => (c.rateBp === null ? '기본 요율 따름' : formatRate(c.rateBp));

/** Maker fee rates (FEE-1 to FEE-4): a default and per-market rates, now or from a set time. */
export function FeeRates() {
  const [data, setData] = useState<FeeRateOverview | null>(null);
  const [target, setTarget] = useState(DEFAULT);
  const [rate, setRate] = useState('');
  const [useDefault, setUseDefault] = useState(false);
  const [from, setFrom] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setData(await api<FeeRateOverview>('ops/settings/fee-rates'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const market = target !== DEFAULT;
    const followDefault = market && useDefault;
    const rateBp = followDefault ? null : parseRate(rate);
    if (!followDefault && rateBp === null) {
      setError('요율은 0.00%부터 10.00%까지, 소수점 둘째 자리까지 입력해 주세요.');
      return;
    }
    const [asset, fiat] = market ? target.split('/') : [undefined, undefined];
    const body = {
      asset,
      fiat,
      rateBp,
      effectiveFrom: from ? new Date(from).toISOString() : undefined,
      reason,
    };
    try {
      if (!(await withStepUp(() => api('ops/settings/fee-rates', { body })))) return;
      setRate('');
      setFrom('');
      setReason('');
      setUseDefault(false);
      setSaved(true);
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (!data) return <p className="muted">불러오는 중…</p>;

  return (
    <>
      <p className="muted small-text">
        광고에 보이는 가격은 광고주가 입력한 가격에 요율만큼 더한 값이고, 수수료는 원화로 청구합니다. 테이커
        수수료는 없습니다. 바꾼 요율은 그 뒤에 생기는 주문부터 적용되고, 진행 중인 주문은 처음 요율을 유지합니다.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>마켓</th>
              <th>지금 요율</th>
              <th>설정</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>기본 요율</td>
              <td>{formatRate(data.defaultRateBp)}</td>
              <td className="muted">마켓별 요율이 없는 마켓에 적용</td>
            </tr>
            {data.markets.map((m) => (
              <tr key={`${m.asset}/${m.fiat}`}>
                <td>
                  {m.asset}/{m.fiat}
                </td>
                <td>{formatRate(m.rateBp)}</td>
                <td className="muted">{m.ownRateBp === null ? '기본 요율 따름' : '마켓별 요율'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.scheduled.length > 0 && (
        <>
          <h3>예약된 변경</h3>
          <ul>
            {data.scheduled.map((c) => (
              <li key={c.id}>
                {new Date(c.effectiveFrom).toLocaleString('ko-KR')}부터 {label(c)} {rateText(c)} ({c.reason})
              </li>
            ))}
          </ul>
        </>
      )}

      <form onSubmit={save} className="settings-form">
        <h3>요율 바꾸기</h3>
        <div className="grid2">
          <div>
            <label htmlFor="fee-target">대상</label>
            <select id="fee-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value={DEFAULT}>기본 요율</option>
              {data.markets.map((m) => (
                <option key={`${m.asset}/${m.fiat}`} value={`${m.asset}/${m.fiat}`}>
                  {m.asset}/{m.fiat}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fee-rate">요율 (%, 0.00 ~ 10.00)</label>
            <input
              id="fee-rate"
              inputMode="decimal"
              placeholder="0.25"
              value={rate}
              disabled={useDefault}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="fee-from">적용 시각 (비우면 바로 적용)</label>
            <input id="fee-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          {target !== DEFAULT && (
            <div>
              <label>
                <input
                  type="checkbox"
                  style={{ width: 'auto', marginRight: 6 }}
                  checked={useDefault}
                  onChange={(e) => setUseDefault(e.target.checked)}
                /> 마켓별
                요율을 없애고 기본 요율 따르기
              </label>
            </div>
          )}
        </div>
        <label htmlFor="fee-reason">변경 사유 (감사 로그에 남습니다)</label>
        <input id="fee-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
        <button>요율 저장 (OTP 확인)</button>
        {saved && <p className="muted small-text">저장했습니다.</p>}
        <ErrorText error={error} />
      </form>

      <h3>변경 이력</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>적용 시각</th>
              <th>대상</th>
              <th>요율</th>
              <th>사유</th>
              <th>처리자</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.effectiveFrom).toLocaleString('ko-KR')}</td>
                <td>{label(c)}</td>
                <td>{rateText(c)}</td>
                <td>{c.reason}</td>
                <td className="muted">{c.createdByEmail ?? '시스템'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** How often fee invoices are issued and how long makers have to pay (FEE-6). */
export function BillingForm() {
  const [billing, setBilling] = useState<BillingSettings | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api<{ billing: BillingSettings }>('ops/settings/billing').then((r) => setBilling(r.billing));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!billing) return;
    setError(null);
    setSaved(false);
    try {
      const res = await withStepUp(() =>
        api<{ billing: BillingSettings }>('ops/settings/billing', { method: 'PUT', body: { ...billing, reason } }),
      );
      if (!res) return;
      setBilling(res.billing);
      setReason('');
      setSaved(true);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (!billing) return <p className="muted">불러오는 중…</p>;

  return (
    <form onSubmit={save} className="settings-form">
      <p className="muted small-text">
        청구 주기가 끝나면(한국 시간 자정, 월 청구는 매월 1일) 광고주별로 그 기간에 완료된 주문의 수수료를 묶어
        청구서를 보냅니다. 납부 기한 전날과 당일에 알림을 보내고, 기한이 지나면 완납할 때까지 그 광고주의 광고를
        숨기고 새 광고 등록을 막습니다.
      </p>
      <div className="grid2">
        <div>
          <label htmlFor="billing-cycle">청구 주기</label>
          <select
            id="billing-cycle"
            value={billing.cycle}
            onChange={(e) => setBilling({ ...billing, cycle: e.target.value as BillingSettings['cycle'] })}
          >
            <option value="monthly">월 단위</option>
            <option value="daily">일 단위</option>
          </select>
        </div>
        <div>
          <label htmlFor="billing-due">납부 기한 (발행 후 며칠, 1 ~ 60)</label>
          <input
            id="billing-due"
            type="number"
            min={1}
            max={60}
            value={billing.dueDays}
            onChange={(e) => setBilling({ ...billing, dueDays: Number(e.target.value) })}
          />
        </div>
      </div>
      <label htmlFor="billing-reason">변경 사유 (감사 로그에 남습니다)</label>
      <input id="billing-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
      <button>청구 설정 저장 (OTP 확인)</button>
      {saved && <p className="muted small-text">저장했습니다.</p>}
      <ErrorText error={error} />
    </form>
  );
}
