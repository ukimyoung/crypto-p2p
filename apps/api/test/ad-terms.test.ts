import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AD_TERMS_VERSION, adTerms } from '../src/ads/ad-terms';

describe('ad terms', () => {
  const all = (['sell', 'buy'] as const).flatMap((side) => (['ko', 'en'] as const).map((locale) => adTerms(side, locale)));

  it('hashes the exact text it stores', () => {
    for (const terms of all) {
      expect(terms.version).toBe(AD_TERMS_VERSION);
      expect(terms.hash).toBe(createHash('sha256').update(terms.text, 'utf8').digest('hex'));
      expect(terms.text).toContain(terms.title);
      for (const clause of terms.clauses) expect(terms.text).toContain(clause.body);
      expect(terms.text).toContain(terms.agreement);
    }
    expect(new Set(all.map((t) => t.hash)).size).toBe(all.length);
  });

  it('has the member vouch for their details and give up refunds on completed trades', () => {
    for (const side of ['sell', 'buy'] as const) {
      const { text } = adTerms(side, 'ko');
      for (const detail of ['이름', '이메일', '휴대폰 번호', '은행 계좌', '암호화폐 입출금 주소']) expect(text).toContain(detail);
      expect(text).toContain('허위가 아님을 보증합니다');
      expect(text).toContain('환불이나 취소를 요구하지 않습니다');
    }
  });
});
