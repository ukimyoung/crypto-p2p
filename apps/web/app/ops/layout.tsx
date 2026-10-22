import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OpsShell } from './OpsShell';

export const metadata: Metadata = {
  title: '운영 콘솔 · P2P 거래',
  robots: { index: false, follow: false },
};

export default function OpsLayout({ children }: { children: ReactNode }) {
  return <OpsShell>{children}</OpsShell>;
}
