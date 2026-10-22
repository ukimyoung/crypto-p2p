'use client';

import { createContext, ReactNode, useCallback, useContext } from 'react';
import { Locale, translate, Vars } from './locale';

const LocaleContext = createContext<Locale>('ko');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** `t` translates Korean source text; `date` and `day` format in the viewer's language. */
export function useT() {
  const locale = useContext(LocaleContext);
  const tag = locale === 'en' ? 'en-US' : 'ko-KR';
  const t = useCallback((ko: string, vars?: Vars) => translate(locale, ko, vars), [locale]);
  const date = useCallback((d: string | Date) => new Date(d).toLocaleString(tag), [tag]);
  const day = useCallback((d: string | Date) => new Date(d).toLocaleDateString(tag), [tag]);
  return { t, locale, date, day };
}
