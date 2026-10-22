import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '../lib/en';
import { localeFrom, translate } from '../lib/locale';

const ROOT = join(__dirname, '..');
const HANGUL = /[가-힣]/;
// The operations console stays Korean; the language switch names Korean in Korean.
const SKIP = ['app/ops/', 'components/AuditTable.tsx', 'lib/en.ts', 'lib/units.ts', 'lib/use-operator.ts'];
const NOT_TRANSLATED = new Set(['한국어']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const sources = ['app', 'components', 'lib']
  .flatMap((d) => files(join(ROOT, d)))
  .map((path) => relative(ROOT, path))
  .filter((path) => !SKIP.some((s) => path.startsWith(s)));

/** Splits a source file into string literals and everything else (comments dropped). */
function scan(src: string): { strings: { quote: string; text: string }[]; code: string } {
  const strings: { quote: string; text: string }[] = [];
  let code = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let text = '';
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') text += src[i++];
        text += src[i++];
      }
      i++;
      strings.push({ quote: c, text });
    } else {
      code += c;
      i++;
    }
  }
  return { strings, code };
}

const scanned = sources.map((path) => ({ path, ...scan(readFileSync(join(ROOT, path), 'utf8')) }));

describe('English text', () => {
  it('has no Korean written straight into markup', () => {
    const offenders = scanned.filter((f) => HANGUL.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('builds Korean sentences with t() variables, not template strings', () => {
    const offenders = scanned.flatMap((f) =>
      f.strings.filter((s) => s.quote === '`' && HANGUL.test(s.text)).map((s) => `${f.path}: ${s.text}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has an English entry for every Korean string', () => {
    const missing = new Set<string>();
    for (const f of scanned) {
      for (const s of f.strings) {
        const text = s.text.replace(/\\(['"])/g, '$1');
        if (HANGUL.test(text) && !NOT_TRANSLATED.has(text) && !(text in EN)) missing.add(text);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('keeps the same placeholders in both languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const broken = Object.entries(EN).filter(([ko, en]) => vars(ko).join() !== vars(en).join());
    expect(broken).toEqual([]);
  });

  it('fills in placeholders and falls back to Korean', () => {
    expect(translate('en', '{asset} 사기', { asset: 'BTC' })).toBe('Buy BTC');
    expect(translate('ko', '{asset} 사기', { asset: 'BTC' })).toBe('BTC 사기');
    expect(translate('en', '사전에 없는 문장')).toBe('사전에 없는 문장');
  });
});

describe('language choice', () => {
  it('prefers the cookie, then the browser language', () => {
    expect(localeFrom('en', 'ko-KR,ko;q=0.9')).toBe('en');
    expect(localeFrom(undefined, 'ko-KR,ko;q=0.9')).toBe('ko');
    expect(localeFrom(undefined, 'en-US,en;q=0.9')).toBe('en');
    expect(localeFrom(undefined, null)).toBe('ko');
  });
});
