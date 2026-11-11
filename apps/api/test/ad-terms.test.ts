import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderAdAgreementEmail } from '../src/ads/ad-agreement-email';
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

describe('ad agreement email', () => {
  const base = {
    nickname: '기자77',
    adId: '3f2a9c1e-0000-4000-8000-000000000000',
    asset: 'BTC',
    totalAmount: '0.5',
    priceMinor: 100_000_000n,
    finalPriceMinor: 101_000_000n,
    minOrderFiatMinor: 10_000n,
    maxOrderFiatMinor: 1_000_000n,
    paymentWindowMinutes: 15,
    agreedAt: new Date('2026-11-11T12:19:32Z'),
    ip: '203.0.113.7',
  };

  it('confirms a sell ad with the receiving account and the full terms', () => {
    const { subject, body, html } = renderAdAgreementEmail({
      ...base,
      side: 'sell',
      locale: 'ko',
      paymentMethod: { bankCode: '004', accountLast4: '1098', accountHolder: '박기자' },
    });
    expect(subject).toBe('[P2P Club] 팔기 광고 등록 및 서비스 이용 동의 확인 (BTC · 광고번호 3F2A9C1E)');
    expect(body).toContain('2026-11-11 21:19:32에 아래 팔기 광고를 등록하시면서');
    expect(body).toContain('- 1 BTC 가격: 100,000,000원');
    expect(body).toContain('- 수수료 포함 최종 광고 가격: 101,000,000원');
    expect(body).toContain('- 입금받을 계좌: KB국민은행 ****1098 (박기자)');
    expect(body).toContain('- 접속 IP: 203.0.113.7');
    expect(body).toContain(adTerms('sell', 'ko').text.trimEnd());
    expect(body).not.toContain('약관 버전');
    expect(body).not.toContain(adTerms('sell', 'ko').hash);

    // The HTML version shows the same facts in sections, with member-entered text escaped.
    expect(html).toContain('팔기 광고가 등록되었습니다');
    for (const section of ['광고 정보', '동의 정보', '동의하신 내용 (전문)', '본인이 등록하지 않은 광고인가요?']) {
      expect(html).toContain(section);
    }
    expect(html).toContain('KB국민은행 ****1098 (박기자)');
    expect(html).toContain('203.0.113.7');
    for (const clause of adTerms('sell', 'ko').clauses) expect(html).toContain(clause.heading);
    const evil = renderAdAgreementEmail({ ...base, nickname: '<script>x</script>', side: 'buy', locale: 'ko' });
    expect(evil.html).not.toContain('<script>');
    expect(evil.html).toContain('&lt;script&gt;');
  });

  it('confirms a buy ad without an account line, in English when agreed in English', () => {
    const ko = renderAdAgreementEmail({ ...base, side: 'buy', locale: 'ko' });
    expect(ko.subject).toBe('[P2P Club] 사기 광고 등록 및 서비스 이용 동의 확인 (BTC · 광고번호 3F2A9C1E)');
    expect(ko.body).toContain('- 수수료 포함 실제 입금 가격: 101,000,000원');
    expect(ko.body).not.toContain('입금받을 계좌');
    expect(ko.body).toContain(adTerms('buy', 'ko').text.trimEnd());

    const en = renderAdAgreementEmail({ ...base, side: 'buy', locale: 'en' });
    expect(en.subject).toBe('[P2P Club] Your buy ad is posted and you agreed to the terms (BTC · Ad 3F2A9C1E)');
    expect(en.body).toContain(adTerms('buy', 'en').text.trimEnd());
  });
});
