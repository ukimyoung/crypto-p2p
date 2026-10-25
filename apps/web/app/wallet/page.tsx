'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { WITHDRAWAL_STATUS } from '@/lib/messages';
import { networkLabel } from '@/lib/networks';
import type { Balance, Withdrawal, WithdrawalAddress, WithdrawalLimit } from '@/lib/types';
import { ASSETS, AssetCode, formatUnits, parseUnits } from '@/lib/units';
import { useMe } from '@/lib/use-me';

const decimalsOf = (asset: string) => ASSETS[asset as AssetCode]?.decimals ?? 0;
const fmt = (value: string | bigint, asset: string) => `${formatUnits(value, decimalsOf(asset))} ${asset}`;
const usable = (a: WithdrawalAddress) => new Date(a.usableFrom) <= new Date();
const shortAddress = (a: string) => (a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a);

interface WalletData {
  balances: Balance[];
  addresses: WithdrawalAddress[];
  withdrawals: Withdrawal[];
  limits: WithdrawalLimit[];
}

export default function WalletPage() {
  const { me } = useMe();
  const { t } = useT();
  const [data, setData] = useState<WalletData | null>(null);

  const load = useCallback(async () => {
    const [b, a, w] = await Promise.all([
      api<{ balances: Balance[] }>('wallet/balances'),
      api<{ addresses: WithdrawalAddress[] }>('wallet/addresses'),
      api<{ withdrawals: Withdrawal[]; limits: WithdrawalLimit[] }>('wallet/withdrawals'),
    ]);
    setData({ balances: b.balances, addresses: a.addresses, withdrawals: w.withdrawals, limits: w.limits });
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (me === undefined) return <p className="muted">{t('불러오는 중…')}</p>;
  if (me === null) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return null;
  }
  if (!data) return <p className="muted">{t('불러오는 중…')}</p>;

  return (
    <>
      <h1>{t('내 지갑')}</h1>
      <Balances balances={data.balances} />
      {me.kycLevel > 0 ? (
        <>
          <WithdrawForm data={data} onDone={load} />
          <History withdrawals={data.withdrawals} onChange={load} />
        </>
      ) : (
        <p className="notice">
          {t('출금하려면 먼저 본인인증을 해 주세요.')} <Link href="/account/verify">{t('본인 인증하기')}</Link>
        </p>
      )}
    </>
  );
}

function Balances({ balances }: { balances: Balance[] }) {
  const { t } = useT();
  return (
    <section className="card">
      <h2>{t('잔고')}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('코인')}</th>
              <th>{t('사용 가능')}</th>
              <th>{t('거래 중 잠김')}</th>
              <th>{t('출금 처리 중')}</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.asset}>
                <td>
                  <strong>{b.asset}</strong>
                </td>
                <td>{formatUnits(b.available, decimalsOf(b.asset))}</td>
                <td>{formatUnits(b.escrow, decimalsOf(b.asset))}</td>
                <td>{formatUnits(b.withdrawalPending, decimalsOf(b.asset))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small-text" style={{ marginBottom: 0 }}>
        {t('입금 주소 발급은 수탁(커스터디) 업체 연동 후 열립니다.')}
      </p>
    </section>
  );
}

function WithdrawForm({ data, onDone }: { data: WalletData; onDone: () => Promise<void> }) {
  const { t, date } = useT();
  const [asset, setAsset] = useState<AssetCode>('BTC');
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const decimals = decimalsOf(asset);
  // One withdrawal address per coin, registered on the account page.
  const address = data.addresses.find((a) => a.asset === asset);
  const limit = data.limits.find((l) => l.asset === asset);
  const balance = data.balances.find((b) => b.asset === asset);
  const amount = parseUnits(amountText, decimals);
  const selectedId = address && usable(address) ? address.id : '';
  const remaining = limit?.dailyLimit ? BigInt(limit.dailyLimit) - BigInt(limit.usedToday) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!amount) return setError('출금 수량을 올바르게 입력해 주세요.');
    try {
      const res = await api<{ withdrawal: Withdrawal }>('wallet/withdrawals', {
        body: { addressId: selectedId, amount: amount.toString() },
      });
      setAmountText('');
      setDone(
        res.withdrawal.status === 'requested'
          ? t('출금을 신청했습니다. 금액이 커서 운영팀 검토 후 송금됩니다.')
          : t('출금을 신청했습니다. 곧 송금됩니다.'),
      );
      await onDone();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <section className="card">
      <h2>{t('출금')}</h2>
      <form onSubmit={submit}>
        <div className="grid2">
          <div>
            <label htmlFor="w-asset">{t('코인')}</label>
            <select id="w-asset" value={asset} onChange={(e) => setAsset(e.target.value as AssetCode)}>
              {Object.keys(ASSETS).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="field-label">{t('받을 주소')}</span>
            {address ? (
              <>
                <p className="address" style={{ margin: '8px 0 2px' }}>
                  {address.address}
                </p>
                <p className="muted small-text" style={{ margin: '0 0 8px' }}>
                  {networkLabel(asset, address.network)}
                  {!usable(address) && ' · ' + t('{time}부터 출금 가능', { time: date(address.usableFrom) })}
                </p>
              </>
            ) : (
              <p className="muted small-text" style={{ margin: '8px 0' }}>
                {t('등록한 출금 주소가 없습니다.')}
              </p>
            )}
            <Link href="/account" className="small-text">
              {t(address ? '내 계정에서 출금 주소 변경' : '내 계정에서 출금 주소 등록')}
            </Link>
          </div>
          <div>
            <label htmlFor="w-amount">{t('받을 수량 ({asset})', { asset })}</label>
            <input
              id="w-amount"
              inputMode="decimal"
              placeholder="0.0"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              required
            />
          </div>
        </div>
        {limit && balance && (
          <dl className="kv" style={{ margin: '12px 0' }}>
            <dt>{t('사용 가능')}</dt>
            <dd>{fmt(balance.available, asset)}</dd>
            <dt>{t('네트워크 수수료')}</dt>
            <dd>{fmt(limit.fee, asset)}</dd>
            {amount && (
              <>
                <dt>{t('잔고에서 빠질 수량')}</dt>
                <dd>
                  <strong>{fmt(amount + BigInt(limit.fee), asset)}</strong>
                </dd>
              </>
            )}
            <dt>{t('최소 출금')}</dt>
            <dd>{fmt(limit.minAmount, asset)}</dd>
            <dt>{t('24시간 남은 한도')}</dt>
            <dd>{remaining === null ? t('본인인증 후 출금 가능') : fmt(remaining < 0n ? 0n : remaining, asset)}</dd>
          </dl>
        )}
        <p className="muted small-text">
          {t('블록체인 송금은 되돌릴 수 없습니다. 주소와 네트워크를 다시 한번 확인해 주세요.')}
        </p>
        <button className="full" disabled={!selectedId}>
          {t('출금 신청')}
        </button>
      </form>
      <ErrorText error={error} />
      {done && <p className="notice">{done}</p>}
    </section>
  );
}

function History({ withdrawals, onChange }: { withdrawals: Withdrawal[]; onChange: () => Promise<void> }) {
  const { t, date } = useT();
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setError(null);
    try {
      await api(`wallet/withdrawals/${id}/cancel`, { method: 'POST' });
      await onChange();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (withdrawals.length === 0) return null;
  return (
    <section className="card">
      <h2>{t('출금 내역')}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('신청 시각')}</th>
              <th>{t('수량')}</th>
              <th>{t('주소')}</th>
              <th>{t('상태')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {withdrawals.map((w) => (
              <tr key={w.id}>
                <td>{date(w.createdAt)}</td>
                <td>
                  {fmt(w.amount, w.asset)}
                  <div className="muted small-text">{t('수수료 {fee}', { fee: formatUnits(w.fee, decimalsOf(w.asset)) })}</div>
                </td>
                <td className="address" title={w.address}>
                  {shortAddress(w.address)}
                  <div className="muted small-text">{networkLabel(w.asset, w.network)}</div>
                </td>
                <td>
                  <span className={`badge ${w.status}`}>{t(WITHDRAWAL_STATUS[w.status] ?? w.status)}</span>
                  {w.reviewNote && w.status === 'rejected' && <div className="muted small-text">{w.reviewNote}</div>}
                </td>
                <td>
                  {w.status === 'requested' && (
                    <button type="button" className="secondary small" onClick={() => cancel(w.id)}>
                      {t('취소')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorText error={error} />
    </section>
  );
}
