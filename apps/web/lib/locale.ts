import { EN } from './en';

export type Locale = 'ko' | 'en';
export type Vars = Record<string, string | number>;

export const LOCALE_COOKIE = 'p2p_lang';

/**
 * Korean is the source language: components call `t('한국어 문장')` and English
 * comes from the EN table, keyed by the Korean text. A missing entry falls
 * back to Korean, and a test checks that every `t('...')` has an entry.
 */
export function translate(locale: Locale, ko: string, vars?: Vars): string {
  const text = locale === 'en' ? (EN[ko] ?? ko) : ko;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Picks the language for a first visit: Korean for Korean browsers, English for everyone else. */
export function localeFrom(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (cookie === 'ko' || cookie === 'en') return cookie;
  return /^ko\b/i.test(acceptLanguage?.trim() || 'ko') ? 'ko' : 'en';
}
