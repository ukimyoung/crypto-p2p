'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect } from 'react';
import { api } from '@/lib/api';
import { LocaleProvider } from '@/lib/i18n';
import { OPERATOR_ROLE } from '@/lib/messages';
import type { Operator } from '@/lib/types';
import { useOperator } from '@/lib/use-operator';

const OperatorContext = createContext<Operator | null>(null);

/** The logged-in operator. Only valid inside the console (not on /ops/login). */
export function useCurrentOperator(): Operator {
  const operator = useContext(OperatorContext);
  if (!operator) throw new Error('useCurrentOperator outside the console');
  return operator;
}

const LINKS = [
  ['/ops', '대시보드'],
  ['/ops/users', '회원'],
  ['/ops/ads', '광고'],
  ['/ops/orders', '주문'],
  ['/ops/disputes', '분쟁'],
  ['/ops/withdrawals', '출금 검토'],
  ['/ops/fees', '수수료 청구'],
  ['/ops/markets', '마켓'],
  ['/ops/settings', '정책 설정'],
  ['/ops/audit', '감사 로그'],
] as const;

export function OpsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { operator } = useOperator();
  const isLogin = pathname === '/ops/login';

  useEffect(() => {
    if (operator === null && !isLogin) window.location.href = '/ops/login';
  }, [operator, isLogin]);

  // The console is for the Korean operations team, so it stays in Korean.
  if (isLogin) {
    return (
      <LocaleProvider locale="ko">
        <main>{children}</main>
      </LocaleProvider>
    );
  }
  if (!operator) return <main className="muted">불러오는 중…</main>;

  async function logout() {
    await api('ops/auth/logout', { method: 'POST' });
    window.location.href = '/ops/login';
  }

  return (
    <LocaleProvider locale="ko">
      <OperatorContext.Provider value={operator}>
        <header className="header ops-header">
          <nav className="nav">
            <Link href="/ops" className="brand">
              운영 콘솔
            </Link>
            <div className="nav-links">
              {LINKS.map(([href, label]) => (
                <Link key={href} href={href} className={(href === '/ops' ? pathname === href : pathname.startsWith(href)) ? 'active' : undefined}>
                  {label}
                </Link>
              ))}
              <span className="muted small-text">
                {operator.name} · {OPERATOR_ROLE[operator.role]}
              </span>
              <button type="button" className="link-button" onClick={logout}>
                로그아웃
              </button>
            </div>
          </nav>
        </header>
        <main className="wide">{children}</main>
      </OperatorContext.Provider>
    </LocaleProvider>
  );
}
