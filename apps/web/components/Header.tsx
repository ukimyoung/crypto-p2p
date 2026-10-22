'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe } from '@/lib/use-me';

export function Header() {
  const { me } = useMe();
  const router = useRouter();

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
