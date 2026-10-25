'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Footer } from './Footer';
import { Header } from './Header';

/** Customer pages get the site header and footer. The operations console brings its own frame. */
export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith('/ops')) return <>{children}</>;
  return (
    <>
      <Header />
      <main className={pathname === '/' ? 'home' : undefined}>{children}</main>
      <Footer />
    </>
  );
}
