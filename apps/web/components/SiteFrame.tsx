'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Header } from './Header';

/** Customer pages get the site header. The operations console brings its own frame. */
export function SiteFrame({ children }: { children: ReactNode }) {
  if (usePathname().startsWith('/ops')) return <>{children}</>;
  return (
    <>
      <Header />
      <main>{children}</main>
    </>
  );
}
