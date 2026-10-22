'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/use-me';

export function Header() {
  const { me } = useMe();
  const router = useRouter();
  const unread = useUnreadCount(Boolean(me));

  async function logout() {
    await api('auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="header">
      <nav className="nav">
        <Link href="/" className="brand">
          P2P 거래
        </Link>
        <div className="nav-links">
          <Link href="/">마켓</Link>
          {me && (
            <>
              <Link href="/orders">내 주문</Link>
              <Link href="/ads/new">광고 등록</Link>
              <Link href="/wallet">내 지갑</Link>
              <Link href="/notifications" aria-label={`알림 ${unread}건 안 읽음`}>
                알림{unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
              </Link>
              <Link href="/account">내 계정</Link>
              <button type="button" className="link-button" onClick={logout}>
                로그아웃
              </button>
            </>
          )}
          {me === null && (
            <>
              <Link href="/login">로그인</Link>
              <Link href="/signup" className="button small">
                가입하기
              </Link>
            </>
          )}
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
