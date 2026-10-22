'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { LOCALE_COOKIE } from '@/lib/locale';
import { useMe } from '@/lib/use-me';

export function Header() {
  const { me } = useMe();
  const router = useRouter();
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
        <Link href="/" className="brand">
          {t('P2P 거래')}
        </Link>
        <div className="nav-links">
          <Link href="/">{t('마켓')}</Link>
          {me && (
            <>
              <Link href="/orders">{t('내 주문')}</Link>
              <Link href="/ads/new">{t('광고 등록')}</Link>
              <Link href="/wallet">{t('내 지갑')}</Link>
              <Link href="/notifications" aria-label={t('알림 {n}건 안 읽음', { n: unread })}>
                {t('알림')}
                {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
              </Link>
              <Link href="/account">{t('내 계정')}</Link>
              <button type="button" className="link-button" onClick={logout}>
                {t('로그아웃')}
              </button>
            </>
          )}
          {me === null && (
            <>
              <Link href="/login">{t('로그인')}</Link>
              <Link href="/signup" className="button small">
                {t('가입하기')}
              </Link>
            </>
          )}
          <button type="button" className="link-button" onClick={switchLanguage} lang={locale === 'ko' ? 'en' : 'ko'}>
            {locale === 'ko' ? 'English' : '한국어'}
          </button>
        </div>
      </nav>
    </header>
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
