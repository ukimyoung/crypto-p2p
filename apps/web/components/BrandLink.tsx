'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { LogoMark } from './Logo';

// The logo always opens the very top of the landing page. On the landing
// page itself a plain link to "/" would not move, or would keep a #hash.
export function BrandLink() {
  const pathname = usePathname();
  const { t } = useT();
  return (
    <Link
      href="/"
      className="brand"
      onClick={() => {
        if (pathname !== '/') return;
        if (window.location.hash) history.replaceState(history.state, '', '/');
        window.scrollTo({ top: 0, behavior: 'instant' });
      }}
    >
      <LogoMark />
      {t('P2P 거래')}
    </Link>
  );
}
