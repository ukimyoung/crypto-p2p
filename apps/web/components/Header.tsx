'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { LOCALE_COOKIE } from '@/lib/locale';
import { useMe } from '@/lib/use-me';
import { LogoMark } from './Logo';

export function Header() {
  const { me } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href)) ? 'active' : undefined;
  const unread = useUnreadCount(Boolean(me));
  const { t, locale } = useT();

  async function switchLanguage() {
    const next = locale === 'ko' ? 'en' : 'ko';
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    // Emails follow the saved language too.
    if (me) await api('me/locale', { body: { locale: next } }).catch(() => {});
    window.location.reload();
  }

  async function logout() {
    await api('auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="header">
      <nav className="nav">
        <div className="nav-main">
          <Link href="/" className="brand">
            <LogoMark />
            {t('P2P 거래')}
          </Link>
          <div className="nav-links">
            <Link href="/" className={active('/')}>
              {t('P2P 마켓')}
            </Link>
            {me ? (
              <>
                <Link href="/orders" className={active('/orders')}>
                  {t('내 주문')}
                </Link>
                <Link href="/ads/new" className={active('/ads')}>
                  {t('광고 등록')}
                </Link>
                <Link href="/wallet" className={active('/wallet')}>
                  {t('내 지갑')}
                </Link>
                <Link href="/fees" className={active('/fees')}>
                  {t('수수료')}
                </Link>
              </>
            ) : (
              <Link href="/#how">{t('이용 방법')}</Link>
            )}
          </div>
        </div>
        <div className="nav-links">
          {me && (
            <>
              <Link
                href="/notifications"
                className={active('/notifications')}
                aria-label={t('알림 {n}건 안 읽음', { n: unread })}
              >
                {t('알림')}
                {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
              </Link>
              <Link href="/account" className={active('/account')}>
                {t('내 계정')}
              </Link>
              <button type="button" className="link-button" onClick={logout} style={{ padding: '8px 10px' }}>
                {t('로그아웃')}
              </button>
            </>
          )}
          {me === null && (
            <>
              <Link href="/login" className={active('/login')}>
                {t('로그인')}
              </Link>
              <Link href="/signup" className="button small">
                {t('가입하기')}
              </Link>
            </>
          )}
          <button
            type="button"
            className="lang-switch"
            onClick={switchLanguage}
            lang={locale === 'ko' ? 'en' : 'ko'}
            style={{ marginLeft: 8 }}
          >
            <GlobeIcon />
            {locale === 'ko' ? 'English' : '한국어'}
          </button>
        </div>
      </nav>
    </header>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </svg>
  );
}

/** Unread notifications, checked every 30 seconds and right after the list is opened. */
function useUnreadCount(loggedIn: boolean): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!loggedIn) return;
    const load = () =>
      api<{ unread: number }>('notifications/unread-count')
        .then((r) => setUnread(r.unread))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 30_000);
    window.addEventListener('notifications-read', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('notifications-read', load);
    };
  }, [loggedIn]);
  return unread;
}
