'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { LOCALE_COOKIE } from '@/lib/locale';
import { THEME_COOKIE } from '@/lib/theme';
import { useMe } from '@/lib/use-me';
import { BrandLink } from './BrandLink';

export function Header() {
  const { me } = useMe();
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
    try {
      await api('auth/logout', { method: 'POST' });
    } finally {
      // A full page load: the header lives in the root layout and keeps the
      // signed-in member in state across client-side navigation.
      window.location.href = '/login';
    }
  }

  return (
    <header className="header">
      <nav className="nav">
        <div className="nav-main">
          <BrandLink />
          <div className="nav-links">
            <Link href="/market" className={active('/market')}>
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
              <UserMenu nickname={me.nickname} onLogout={logout} />
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
          <ThemeSwitch />
        </div>
      </nav>
    </header>
  );
}

/**
 * The signed-in member's nickname. Hovering it (or tapping it on a touch
 * screen) shows the logout button.
 */
function UserMenu({ nickname, onLogout }: { nickname: string; onLogout: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className={open ? 'user-menu open' : 'user-menu'}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="user-menu-name">{nickname}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="user-menu-pop">
        <button type="button" className="user-menu-item" onClick={onLogout}>
          {t('로그아웃')}
        </button>
      </div>
    </div>
  );
}

/** Switches between the light and dark theme and remembers the choice for a year. */
function ThemeSwitch() {
  const { t } = useT();

  function toggle() {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    root.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button type="button" className="theme-switch" onClick={toggle} aria-label={t('화면 테마 바꾸기')} title={t('화면 테마 바꾸기')}>
      <svg className="icon-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
      <svg className="icon-sun" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
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
