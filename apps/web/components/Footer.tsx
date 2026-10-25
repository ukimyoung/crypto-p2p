'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { BrandLink } from './BrandLink';

export function Footer() {
  const { t } = useT();
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <BrandLink />
          <p>{t('이용자끼리 직접 거래하고, 코인은 에스크로로 보호합니다.')}</p>
        </div>
        <div>
          <nav className="footer-links">
            <Link href="/market">{t('P2P 마켓')}</Link>
            <Link href="/#how">{t('이용 방법')}</Link>
            <Link href="/fees">{t('수수료')}</Link>
          </nav>
          <p style={{ marginTop: 10 }}>© {new Date().getFullYear()} {t('P2P 거래')}</p>
        </div>
      </div>
    </footer>
  );
}
