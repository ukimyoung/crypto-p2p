'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { NicknameInput } from '@/components/NicknameInput';
import { PhoneField } from '@/components/PhoneField';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fullName } from '@/lib/names';
import { BANKS } from '@/lib/messages';
import { addressExample, networkLabel, RECEIVING_NETWORKS, WITHDRAWAL_NETWORKS } from '@/lib/networks';
import type { Me, PaymentMethod, ReceivingAddress, WithdrawalAddress } from '@/lib/types';
import { useMe } from '@/lib/use-me';

export default function AccountPage() {
  const { me, reload } = useMe();
  const { t } = useT();
  const [editingPhone, setEditingPhone] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

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
          <dt>{t('닉네임')}</dt>
          <dd>
            <NicknameEdit me={me} onSaved={reload} />
          </dd>
          <dt>{t('이름')}</dt>
          <dd>
            <NameEdit me={me} onSaved={reload} />
          </dd>
          <dt>{t('이메일')}</dt>
          <dd>{me.email}</dd>
          <dt>{t('휴대폰 번호')}</dt>
          <dd>
            {me.phone ? (
              <span className="row">
                <strong>{me.phone}</strong>
                {!editingPhone && (
                  <button type="button" className="secondary inline-action" onClick={() => setEditingPhone(true)}>
                    {t('휴대폰 번호 변경')}
                  </button>
                )}
              </span>
            ) : (
              t('미등록')
            )}
          </dd>
          <dt>{t('비밀번호')}</dt>
          <dd>
            <span className="row">
              <strong aria-hidden>••••••••••</strong>
              {!changingPassword && (
                <button type="button" className="secondary inline-action" onClick={() => setChangingPassword(true)}>
                  {t('비밀번호 변경')}
                </button>
              )}
            </span>
          </dd>
          <dt>{t('본인인증(KYC)')}</dt>
          <dd>{me.kycLevel > 0 ? t('완료') : t('미완료')}</dd>
        </dl>
        {me.kycLevel === 0 && (
          <p className="notice" style={{ marginTop: 16, marginBottom: 0 }}>
            {t('본인인증을 마쳐야 주문을 하고 입금 계좌를 등록할 수 있습니다.')}{' '}
            <Link href="/account/verify">{t('본인 인증하기')}</Link>
          </p>
        )}
      </section>
      {(!me.phone || editingPhone) && <PhoneEdit me={me} onSaved={reload} onClose={() => setEditingPhone(false)} />}
      {changingPassword && <PasswordChange onClose={() => setChangingPassword(false)} />}
      {me.kycLevel > 0 && <PaymentMethods />}
      {me.kycLevel > 0 && <ReceivingAddresses />}
      {me.kycLevel > 0 && <WithdrawalAddresses />}
    </>
  );
}

/** The nickname. Only a placeholder nickname, from before signup asked for one, can be replaced, once. */
function NicknameEdit({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState(me.nickname);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('me/nickname', { body: { nickname } });
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className="row">
        <strong>{me.nickname}</strong>
        {me.temporaryNickname && (
          <>
            <span className="muted small-text">{t('임시 닉네임')}</span>
            <button type="button" className="link-button small-text" onClick={() => setOpen(true)}>
              {t('닉네임 정하기')}
            </button>
          </>
        )}
      </span>
    );
  }
  return (
    <form onSubmit={save} style={{ maxWidth: 360 }}>
      <NicknameInput id="nickname-edit" value={nickname} onChange={setNickname} />
      <ErrorText error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="small" disabled={busy}>
          {t('저장')}
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => {
            setOpen(false);
            setNickname(me.nickname);
            setError(null);
          }}
        >
          {t('취소')}
        </button>
      </div>
    </form>
  );
}

/** Shows the name typed at signup. Members who joined before it was asked enter it here, once. */
function NameEdit({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState(me.firstName ?? '');
  const [lastName, setLastName] = useState(me.lastName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = fullName(me.firstName, me.lastName);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('me/name', { body: { firstName, lastName } });
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className="row">
        {name ? (
          <strong>{name}</strong>
        ) : (
          <>
            <span className="muted">{t('미입력')}</span>
            <button type="button" className="link-button small-text" onClick={() => setOpen(true)}>
              {t('입력')}
            </button>
          </>
        )}
      </span>
    );
  }
  return (
    <form onSubmit={save} style={{ maxWidth: 420 }}>
      <div className="name-fields">
        <div>
          <label htmlFor="firstName-edit">{t('이름 (First name)')}</label>
          <input
            id="firstName-edit"
            autoComplete="given-name"
            maxLength={50}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="lastName-edit">{t('성 (Last name)')}</label>
          <input
            id="lastName-edit"
            autoComplete="family-name"
            maxLength={50}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
      </div>
      <p className="muted small-text" style={{ margin: '6px 0 0' }}>
        {t('한 번 저장하면 바꿀 수 없으니 정확히 입력해 주세요.')}
      </p>
      <ErrorText error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="small" disabled={busy}>
          {t('저장')}
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => {
            setOpen(false);
            setFirstName(me.firstName ?? '');
            setLastName(me.lastName ?? '');
            setError(null);
          }}
        >
          {t('취소')}
        </button>
      </div>
    </form>
  );
}

/** Members who joined before phone numbers were asked add one here; others open it from the button beside their number. */
function PhoneEdit({ me, onSaved, onClose }: { me: Me; onSaved: () => Promise<void>; onClose: () => void }) {
  const { t } = useT();
  const [country, setCountry] = useState(me.phoneCountry ?? 'KR');
  const [number, setNumber] = useState(me.phoneNational ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('me/phone', { body: { phoneCountry: country, phoneNumber: number } });
      onClose();
      await onSaved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t(me.phone ? '휴대폰 번호 변경' : '휴대폰 번호 등록')}</h2>
      {!me.phone && <p className="muted small-text">{t('연락받을 휴대폰 번호를 국가 번호와 함께 등록해 주세요.')}</p>}
      <form onSubmit={save}>
        <PhoneField id="account-phone" country={country} number={number} onCountry={setCountry} onNumber={setNumber} />
        <div className="row" style={{ marginTop: 16 }}>
          <button disabled={busy}>{t('저장')}</button>
          {me.phone && (
            <button type="button" className="secondary" onClick={onClose}>
              {t('취소')}
            </button>
          )}
        </div>
      </form>
      <ErrorText error={error} />
    </section>
  );
}

/** Changes the password after checking the current one. Other devices are signed out. */
function PasswordChange({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError(t('비밀번호 확인이 일치하지 않습니다.'));
      return;
    }
    setBusy(true);
    try {
      await api('me/password', { body: { currentPassword, newPassword } });
      setDone(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="card">
        <h2>{t('비밀번호 변경')}</h2>
        <p>{t('비밀번호를 변경했습니다. 다른 기기에서는 로그아웃되었습니다.')}</p>
        <button type="button" className="secondary" onClick={onClose}>
          {t('닫기')}
        </button>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>{t('비밀번호 변경')}</h2>
      <form onSubmit={save} style={{ maxWidth: 420 }}>
        <label htmlFor="current-password">{t('현재 비밀번호')}</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <label htmlFor="new-password">{t('새 비밀번호 (10자 이상, 영문과 숫자 포함, 특수문자 사용 가능)')}</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <label htmlFor="confirm-password">{t('새 비밀번호 확인')}</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <p className="muted small-text" style={{ margin: '6px 0 0' }}>
          {t('변경하면 지금 쓰는 기기를 뺀 다른 기기에서는 모두 로그아웃됩니다.')}
        </p>
        <ErrorText error={error} />
        <div className="row" style={{ marginTop: 16 }}>
          <button disabled={busy}>{t('저장')}</button>
          <button type="button" className="secondary" onClick={onClose}>
            {t('취소')}
          </button>
        </div>
      </form>
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
      const fields = { bankCode, accountHolder: holder, accountNumber: account };
      if (current) {
        await api(`payment-methods/${current.id}`, { method: 'PUT', body: fields });
      } else {
        await api('payment-methods', { body: { fiat: 'KRW', ...fields } });
      }
      setAccount('');
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

/** A receiving or withdrawal address; only withdrawal addresses have a cooldown. */
type CryptoAddress = Pick<ReceivingAddress, 'asset' | 'network' | 'address'> & Partial<Pick<WithdrawalAddress, 'usableFrom'>>;
type Networks = Record<string, { value: string; label: string }[]>;

/** Coins sent to the member: where buyers and others send them. */
function ReceivingAddresses() {
  const { t } = useT();
  return (
    <AddressSection
      title={t('입금받을 암호화폐 주소')}
      description={t(
        '코인별로 받을 주소를 1개씩 등록할 수 있습니다. 먼저 네트워크를 고르고 그 네트워크의 주소를 입력하세요. 네트워크가 다르면 코인을 잃을 수 있으니 받는 지갑의 네트워크를 꼭 확인해 주세요.',
      )}
      networks={RECEIVING_NETWORKS}
      path="receiving-addresses"
      listField="receivingAddresses"
      formTitle={(asset, changing) =>
        t(changing ? '{asset} 입금 주소 변경' : '{asset} 입금 주소 등록', { asset })
      }
      confirmRemove={(asset) => t('{asset} 입금 주소를 삭제할까요?', { asset })}
    />
  );
}

/** The whitelist withdrawals from 내 지갑 go to, one address per coin. */
function WithdrawalAddresses() {
  const { t } = useT();
  return (
    <AddressSection
      title={t('출금 주소')}
      description={t(
        '내 지갑에서 출금하면 코인별로 등록한 이 주소로만 보냅니다. 새로 등록하거나 바꾼 주소는 도용 피해를 막기 위해 24시간 뒤부터 출금할 수 있습니다. 네트워크는 지금 출금을 지원하는 것만 고를 수 있습니다.',
      )}
      networks={WITHDRAWAL_NETWORKS}
      path="wallet/addresses"
      listField="addresses"
      formTitle={(asset, changing) =>
        t(changing ? '{asset} 출금 주소 변경' : '{asset} 출금 주소 등록', { asset })
      }
      confirmRemove={(asset) => t('{asset} 출금 주소를 삭제할까요?', { asset })}
    />
  );
}

/** One crypto address per coin. The network is chosen first, and the address is checked against it. */
function AddressSection({
  title,
  description,
  networks,
  path,
  listField,
  formTitle,
  confirmRemove,
}: {
  title: string;
  description: string;
  networks: Networks;
  path: string;
  /** Where the list sits in the API's answer to GET `path`. */
  listField: string;
  formTitle: (asset: string, changing: boolean) => string;
  confirmRemove: (asset: string) => string;
}) {
  const { t, date } = useT();
  const [addresses, setAddresses] = useState<CryptoAddress[] | undefined>(undefined);
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await api<Record<string, CryptoAddress[]>>(path);
    setAddresses(res[listField] ?? []);
  }, [path, listField]);

  useEffect(() => {
    void load();
  }, [load]);

  if (addresses === undefined) return null;

  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted small-text">{description}</p>
      <ul className="receiving-list">
        {Object.keys(networks).map((asset) => {
          const current = addresses.find((a) => a.asset === asset);
          const waiting = current?.usableFrom && new Date(current.usableFrom) > new Date();
          return (
            <li key={asset}>
              <div className="row">
                <strong>{asset}</strong>
                <span className="muted small-text">{current ? networkLabel(asset, current.network) : t('미등록')}</span>
                {waiting && (
                  <span className="muted small-text">{t('{time}부터 출금 가능', { time: date(current.usableFrom!) })}</span>
                )}
                {editing !== asset && (
                  <button type="button" className="link-button small-text" onClick={() => setEditing(asset)}>
                    {t(current ? '변경' : '등록')}
                  </button>
                )}
              </div>
              {current && <div className="address">{current.address}</div>}
            </li>
          );
        })}
      </ul>
      {editing && (
        <AddressForm
          key={editing}
          asset={editing}
          networks={networks[editing] ?? []}
          path={path}
          current={addresses.find((a) => a.asset === editing)}
          title={formTitle(editing, addresses.some((a) => a.asset === editing))}
          confirmRemove={confirmRemove(editing)}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

function AddressForm({
  asset,
  networks,
  path,
  current,
  title,
  confirmRemove,
  onClose,
  onSaved,
}: {
  asset: string;
  networks: { value: string; label: string }[];
  path: string;
  current: CryptoAddress | undefined;
  title: string;
  confirmRemove: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useT();
  const [network, setNetwork] = useState(current?.network ?? networks[0]?.value ?? '');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = path.replace(/\W/g, '-');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onSaved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void run(() => api(`${path}/${asset}`, { method: 'PUT', body: { network, address } }));
  }

  function remove() {
    if (!window.confirm(confirmRemove)) return;
    void run(() => api(`${path}/${asset}`, { method: 'DELETE' }));
  }

  return (
    <form onSubmit={save} className="settings-form">
      <h3>{title}</h3>
      <label htmlFor={`${id}-network`}>{t('네트워크')}</label>
      <select id={`${id}-network`} value={network} onChange={(e) => setNetwork(e.target.value)}>
        {networks.map((n) => (
          <option key={n.value} value={n.value}>
            {n.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-address`}>{t(current ? '새 주소' : '주소')}</label>
      <input
        id={`${id}-address`}
        className="address"
        autoComplete="off"
        spellCheck={false}
        placeholder={addressExample(network)}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        required
      />
      <ErrorText error={error} />
      <div className="row">
        <button disabled={busy}>{t(current ? '주소 변경' : '주소 등록')}</button>
        <button type="button" className="secondary" onClick={onClose}>
          {t('취소')}
        </button>
        {current && (
          <button type="button" className="secondary" disabled={busy} onClick={remove}>
            {t('삭제')}
          </button>
        )}
      </div>
    </form>
  );
}
