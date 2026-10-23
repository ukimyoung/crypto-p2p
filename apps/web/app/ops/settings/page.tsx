'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import type { WithdrawalRules } from '@/lib/types';
import { ASSETS, AssetCode, formatUnits, parseUnits } from '@/lib/units';
import { withStepUp } from '@/lib/use-operator';
import { BillingForm, FeeRates } from './FeeSettings';

/** KYC levels that get a daily limit field. A level left empty cannot withdraw. */
const KYC_LEVELS = [1, 2];

const decimalsOf = (asset: string) => ASSETS[asset as AssetCode]?.decimals ?? 0;

/** Like parseUnits, but "0" is allowed (no fee, or review everything). */
function parseUnitsOrZero(input: string, decimals: number): bigint | null {
  return /^0*(\.0*)?$/.test(input.trim()) && input.trim() !== '' ? 0n : parseUnits(input, decimals);
}

export default function OpsSettingsPage() {
  const [rules, setRules] = useState<WithdrawalRules[] | null>(null);

  const load = useCallback(async () => {
    setRules((await api<{ rules: WithdrawalRules[] }>('ops/settings/withdrawal-rules')).rules);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1>정책 설정</h1>
      <section className="card">
        <h2>광고 수수료율</h2>
        <FeeRates />
      </section>
      <section className="card">
        <h2>수수료 청구</h2>
        <BillingForm />
      </section>
      <section className="card">
        <h2>출금 수수료와 한도</h2>
        <p className="muted small-text">
          바꾼 값은 다음 출금 신청부터 적용됩니다. 저장할 때 OTP 코드를 다시 확인하고, 바꾸기 전과 후의 값이 감사
          로그에 남습니다.
        </p>
        {rules === null && <p className="muted">불러오는 중…</p>}
        {rules?.map((r) => <RulesForm key={r.asset} rules={r} onSaved={load} />)}
      </section>
    </>
  );
}

function RulesForm({ rules, onSaved }: { rules: WithdrawalRules; onSaved: () => Promise<void> }) {
  const decimals = decimalsOf(rules.asset);
  const show = (v: string | undefined) => (v === undefined ? '' : formatUnits(v, decimals).replace(/,/g, ''));
  const [fee, setFee] = useState(show(rules.fee));
  const [minAmount, setMinAmount] = useState(show(rules.minAmount));
  const [autoApproveMax, setAutoApproveMax] = useState(show(rules.autoApproveMax));
  const [limits, setLimits] = useState<Record<number, string>>(
    Object.fromEntries(KYC_LEVELS.map((level) => [level, show(rules.dailyLimitByKycLevel[level])])),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const feeUnits = parseUnitsOrZero(fee, decimals);
    const minUnits = parseUnits(minAmount, decimals);
    const autoUnits = parseUnitsOrZero(autoApproveMax, decimals);
    if (feeUnits === null || minUnits === null || autoUnits === null) {
      setError(`수량은 소수점 ${decimals}자리까지의 숫자로 입력해 주세요. 최소 출금 수량은 0보다 커야 합니다.`);
      return;
    }
    const dailyLimits: Record<string, string> = {};
    for (const level of KYC_LEVELS) {
      const text = limits[level]?.trim() ?? '';
      if (!text) continue;
      const value = parseUnits(text, decimals);
      if (value === null) {
        setError(`KYC ${level}단계 한도는 0보다 큰 숫자로 입력하거나 비워 두세요.`);
        return;
      }
      dailyLimits[level] = value.toString();
    }
    try {
      const body = {
        fee: feeUnits.toString(),
        minAmount: minUnits.toString(),
        autoApproveMax: autoUnits.toString(),
        dailyLimits,
        reason,
      };
      if (!(await withStepUp(() => api(`ops/settings/withdrawal-rules/${rules.asset}`, { method: 'PUT', body })))) {
        return;
      }
      setReason('');
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <form onSubmit={save} className="settings-form">
      <h3>{rules.asset}</h3>
      <div className="grid2">
        <div>
          <label htmlFor={`${rules.asset}-fee`}>출금 수수료 ({rules.asset})</label>
          <input id={`${rules.asset}-fee`} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${rules.asset}-min`}>최소 출금 수량 ({rules.asset})</label>
          <input
            id={`${rules.asset}-min`}
            inputMode="decimal"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${rules.asset}-auto`}>자동 승인 기준 ({rules.asset}, 0이면 모두 검토)</label>
          <input
            id={`${rules.asset}-auto`}
            inputMode="decimal"
            value={autoApproveMax}
            onChange={(e) => setAutoApproveMax(e.target.value)}
          />
        </div>
        {KYC_LEVELS.map((level) => (
          <div key={level}>
            <label htmlFor={`${rules.asset}-kyc${level}`}>
              KYC {level}단계 24시간 한도 ({rules.asset}, 비우면 출금 불가)
            </label>
            <input
              id={`${rules.asset}-kyc${level}`}
              inputMode="decimal"
              value={limits[level] ?? ''}
              onChange={(e) => setLimits({ ...limits, [level]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <label htmlFor={`${rules.asset}-reason`}>변경 사유 (감사 로그에 남습니다)</label>
      <input id={`${rules.asset}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} required />
      <button>{rules.asset} 저장 (OTP 확인)</button>
      {saved && <p className="muted small-text">저장했습니다.</p>}
      <ErrorText error={error} />
    </form>
  );
}
