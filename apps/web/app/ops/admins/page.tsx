'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { OPERATOR_ROLE } from '@/lib/messages';
import type { OperatorAccount, OperatorOtp, OperatorRole } from '@/lib/types';
import { isAdmin, withStepUp } from '@/lib/use-operator';
import { useCurrentOperator } from '../OpsShell';

const STATUS: Record<OperatorAccount['status'], string> = { active: '사용 중', disabled: '사용 중지' };

/** Operator accounts. Only administrators see this page; every change needs a fresh OTP code. */
export default function OpsAdminsPage() {
  const me = useCurrentOperator();
  const [operators, setOperators] = useState<OperatorAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The OTP secret of a new or reset account, shown once.
  const [otp, setOtp] = useState<(OperatorOtp & { email: string }) | null>(null);

  const load = useCallback(async () => {
    setOperators((await api<{ operators: OperatorAccount[] }>('ops/operators')).operators);
  }, []);

  useEffect(() => {
    if (isAdmin(me)) void load();
  }, [load, me]);

  /** Runs a change behind the OTP prompt. `done` is false if it failed or was cancelled. */
  async function run<T>(action: () => Promise<T>): Promise<{ done: boolean; result?: T }> {
    setError(null);
    try {
      // Wrapped because a delete answers with no body, which withStepUp would read as cancelled.
      const outcome = await withStepUp(async () => ({ result: await action() }));
      return outcome ? { done: true, result: outcome.result } : { done: false };
    } catch (err) {
      setError(messageOf(err));
      return { done: false };
    } finally {
      await load();
    }
  }

  async function update(o: OperatorAccount, changes: Partial<Pick<OperatorAccount, 'name' | 'role' | 'status'>>) {
    await run(() => api(`ops/operators/${o.id}`, { method: 'PUT', body: changes }));
  }

  async function rename(o: OperatorAccount) {
    const name = window.prompt(`${o.email}의 새 이름을 적어 주세요.`, o.name)?.trim();
    if (name && name !== o.name) await update(o, { name });
  }

  async function reset(o: OperatorAccount) {
    const password = window.prompt(
      `${o.name}(${o.email})의 비밀번호와 OTP를 새로 정합니다. 지금 로그인된 세션은 끊깁니다.\n새 비밀번호(10자 이상, 영문과 숫자 포함)를 적어 주세요.`,
    );
    if (!password) return;
    const { result } = await run(() =>
      api<OperatorOtp>(`ops/operators/${o.id}/reset-credentials`, { body: { password } }),
    );
    if (result) setOtp({ otpSecret: result.otpSecret, otpauthUrl: result.otpauthUrl, email: o.email });
  }

  async function remove(o: OperatorAccount) {
    if (!window.confirm(`${o.name}(${o.email}) 계정을 삭제합니다. 로그인할 수 없게 되고 목록에서 사라집니다. 계속할까요?`)) {
      return;
    }
    await run(() => api(`ops/operators/${o.id}`, { method: 'DELETE' }));
  }

  if (!isAdmin(me)) {
    return (
      <>
        <h1>관리자 관리</h1>
        <p className="muted">administrator만 볼 수 있는 화면입니다.</p>
      </>
    );
  }

  return (
    <>
      <h1>관리자 관리</h1>
      <p className="muted small-text">
        reviewer는 조회, 출금·분쟁 처리, 회원 제한, 정책 변경을 할 수 있습니다. administrator는 여기에 더해 마켓 상태,
        청구 실행, 관리자 계정을 관리합니다. 바꿀 때마다 OTP 코드를 다시 확인하고, 모든 변경은 감사 로그에 남습니다.
        활성 administrator는 적어도 한 명 남아야 하고, 내 역할과 상태는 다른 administrator가 바꿉니다.
      </p>
      <ErrorText error={error} />
      {otp && <OtpCard otp={otp} onClose={() => setOtp(null)} />}
      <section className="card">
        <h2>관리자 목록</h2>
        {operators === null ? (
          <p className="muted">불러오는 중…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>역할</th>
                  <th>상태</th>
                  <th>마지막 로그인</th>
                  <th>등록일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {operators.map((o) => {
                  const self = o.id === me.id;
                  return (
                    <tr key={o.id}>
                      <td>
                        {o.name}
                        {self && <span className="muted"> (나)</span>}
                      </td>
                      <td>{o.email}</td>
                      <td>
                        {self ? (
                          OPERATOR_ROLE[o.role]
                        ) : (
                          <select
                            aria-label={`${o.email} 역할`}
                            value={o.role}
                            style={{ width: 'auto' }}
                            onChange={(e) => update(o, { role: e.target.value as OperatorRole })}
                          >
                            {Object.entries(OPERATOR_ROLE).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {self ? (
                          STATUS[o.status]
                        ) : (
                          <select
                            aria-label={`${o.email} 상태`}
                            value={o.status}
                            style={{ width: 'auto' }}
                            onChange={(e) => update(o, { status: e.target.value as OperatorAccount['status'] })}
                          >
                            {Object.entries(STATUS).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="muted">{o.lastLoginAt ? new Date(o.lastLoginAt).toLocaleString('ko-KR') : '-'}</td>
                      <td className="muted">{new Date(o.createdAt).toLocaleDateString('ko-KR')}</td>
                      <td>
                        <div className="actions">
                          <button type="button" className="small secondary" onClick={() => rename(o)}>
                            이름 변경
                          </button>
                          <button type="button" className="small secondary" onClick={() => reset(o)}>
                            비밀번호·OTP 재설정
                          </button>
                          {!self && (
                            <button type="button" className="small danger" onClick={() => remove(o)}>
                              삭제
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h2>관리자 등록</h2>
        <CreateForm
          onCreated={async (created) => {
            setOtp(created);
            await load();
          }}
        />
      </section>
    </>
  );
}

function CreateForm({ onCreated }: { onCreated: (otp: OperatorOtp & { email: string }) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<OperatorRole>('reviewer');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await withStepUp(() =>
        api<OperatorOtp & { operator: OperatorAccount }>('ops/operators', { body: { email, name, role, password } }),
      );
      if (!created) return;
      setEmail('');
      setName('');
      setRole('reviewer');
      setPassword('');
      await onCreated({ otpSecret: created.otpSecret, otpauthUrl: created.otpauthUrl, email: created.operator.email });
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="muted small-text">
        등록하면 OTP 비밀키가 한 번만 보입니다. 새 관리자에게 초기 비밀번호와 함께 안전하게 전달해 인증 앱에 등록하게
        해 주세요.
      </p>
      <div className="grid2">
        <div>
          <label htmlFor="op-email">이메일</label>
          <input id="op-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="op-name">이름</label>
          <input id="op-name" required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="op-role">역할</label>
          <select id="op-role" value={role} onChange={(e) => setRole(e.target.value as OperatorRole)}>
            {Object.entries(OPERATOR_ROLE).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="op-password">초기 비밀번호</label>
          <input
            id="op-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>
      <ErrorText error={error} />
      <button className="full">등록</button>
    </form>
  );
}

function OtpCard({ otp, onClose }: { otp: OperatorOtp & { email: string }; onClose: () => void }) {
  return (
    <section className="card">
      <h2>{otp.email}의 OTP 비밀키</h2>
      <p className="small-text">
        이 화면을 닫으면 다시 볼 수 없습니다. 인증 앱(Google Authenticator 등)에서 키를 직접 입력하거나 아래 URL로
        등록하게 해 주세요.
      </p>
      <p>
        <code>{otp.otpSecret}</code>
      </p>
      <p className="muted small-text" style={{ wordBreak: 'break-all' }}>
        {otp.otpauthUrl}
      </p>
      <button type="button" className="small secondary" onClick={onClose}>
        확인했습니다
      </button>
    </section>
  );
}
