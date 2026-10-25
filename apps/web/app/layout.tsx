import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { SiteFrame } from '@/components/SiteFrame';
import { LocaleProvider } from '@/lib/i18n';
import { LOCALE_COOKIE, localeFrom, translate } from '@/lib/locale';
import './globals.css';

async function currentLocale() {
  return localeFrom((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get('accept-language'));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return {
    title: translate(locale, 'P2P 거래'),
    description: translate(locale, '이용자끼리 직접 거래하고, 코인은 에스크로로 보호합니다.'),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <LocaleProvider locale={locale}>
          <SiteFrame>{children}</SiteFrame>
        </LocaleProvider>
      </body>
    </html>
  );
}
