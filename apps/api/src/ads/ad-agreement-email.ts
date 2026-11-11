import { AdSide, adTerms, TermsLocale } from './ad-terms';

/**
 * The confirmation email sent when a member posts an ad: what they agreed to, on which ad, when and
 * from where. The plain-text body queued in `email_outbox` is exactly what goes out, so that row is
 * the record of what was sent.
 */
export interface AdAgreementEmailInput {
  side: AdSide;
  locale: TermsLocale;
  nickname: string;
  adId: string;
  asset: string;
  /** Whole-coin amount as text, e.g. "0.015". */
  totalAmount: string;
  priceMinor: bigint;
  finalPriceMinor: bigint;
  minOrderFiatMinor: bigint;
  maxOrderFiatMinor: bigint;
  paymentWindowMinutes: number;
  /** Sell ads only. */
  paymentMethod?: { bankCode: string; accountLast4: string; accountHolder: string } | null;
  agreedAt: Date;
  ip: string | null;
}

/** A few common Korean bank codes (KFTC), as the web app lists them. */
const BANKS: Record<string, { ko: string; en: string }> = {
  '004': { ko: 'KB국민은행', en: 'KB Kookmin Bank' },
  '088': { ko: '신한은행', en: 'Shinhan Bank' },
  '020': { ko: '우리은행', en: 'Woori Bank' },
  '081': { ko: '하나은행', en: 'Hana Bank' },
  '011': { ko: 'NH농협은행', en: 'NH NongHyup Bank' },
  '003': { ko: 'IBK기업은행', en: 'IBK Industrial Bank of Korea' },
  '090': { ko: '카카오뱅크', en: 'KakaoBank' },
  '092': { ko: '토스뱅크', en: 'Toss Bank' },
  '089': { ko: '케이뱅크', en: 'K Bank' },
};

/** Short reference shown to members for an ad. */
export const adRef = (adId: string) => adId.replace(/-/g, '').slice(0, 8).toUpperCase();

/** 2026-11-11 21:19:32 in Korea time. */
function koreaTime(at: Date): string {
  return at.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false });
}

const krw = (minor: bigint) => Number(minor).toLocaleString('ko-KR');

export function renderAdAgreementEmail(input: AdAgreementEmailInput): { subject: string; body: string } {
  const terms = adTerms(input.side, input.locale);
  const ref = adRef(input.adId);
  const { asset } = input;
  const bank = input.paymentMethod ? (BANKS[input.paymentMethod.bankCode]?.[input.locale] ?? input.paymentMethod.bankCode) : null;
  const account = input.paymentMethod
    ? `${bank} ****${input.paymentMethod.accountLast4} (${input.paymentMethod.accountHolder})`
    : null;
  const when = koreaTime(input.agreedAt);

  if (input.locale === 'en') {
    const kind = input.side === 'sell' ? 'sell' : 'buy';
    const adLines = [
      `- Ad number: ${ref}`,
      `- Coin: ${asset}`,
      input.side === 'sell'
        ? `- Price per ${asset}: ${krw(input.priceMinor)} KRW (final ad price with fee ${krw(input.finalPriceMinor)} KRW)`
        : `- Price per ${asset}: ${krw(input.priceMinor)} KRW (amount you actually pay with fee ${krw(input.finalPriceMinor)} KRW)`,
      `- Total amount: ${input.totalAmount} ${asset}`,
      `- Limit per order: ${krw(input.minOrderFiatMinor)} – ${krw(input.maxOrderFiatMinor)} KRW`,
      `- Payment window: ${input.paymentWindowMinutes} minutes`,
      ...(account ? [`- Account for receiving payment: ${account}`] : []),
    ];
    return {
      subject: `[P2P Club] Your ${kind} ad is posted and you agreed to the terms (${asset} · Ad ${ref})`,
      body: [
        `Hello ${input.nickname},`,
        '',
        `On ${when} (Korea time) you posted the ${kind} ad below and agreed to the "${terms.title}". This email was sent automatically to confirm that you agreed and what you agreed to. Please keep it for your records.`,
        '',
        '■ Ad details',
        ...adLines,
        '',
        '■ Agreement details',
        `- Agreed at: ${when} (Korea time)`,
        `- IP address: ${input.ip ?? '-'}`,
        '',
        '■ What you agreed to (full text)',
        terms.text.trimEnd(),
        '',
        'If you did not post this ad, change your password right away and let our support team know.',
        'This mailbox is not monitored.',
      ].join('\n'),
    };
  }

  const kind = input.side === 'sell' ? '팔기' : '사기';
  const adLines = [
    `- 광고 번호: ${ref}`,
    `- 코인: ${asset}`,
    input.side === 'sell'
      ? `- 1 ${asset} 가격: ${krw(input.priceMinor)}원 (수수료 포함 최종 광고 가격 ${krw(input.finalPriceMinor)}원)`
      : `- 1 ${asset} 가격: ${krw(input.priceMinor)}원 (수수료 포함 실제 입금 가격 ${krw(input.finalPriceMinor)}원)`,
    `- 총 수량: ${input.totalAmount} ${asset}`,
    `- 주문당 한도: ${krw(input.minOrderFiatMinor)}원 ~ ${krw(input.maxOrderFiatMinor)}원`,
    `- 결제 기한: ${input.paymentWindowMinutes}분`,
    ...(account ? [`- 입금받을 계좌: ${account}`] : []),
  ];
  return {
    subject: `[P2P Club] ${kind} 광고 등록 및 서비스 이용 동의 확인 (${asset} · 광고번호 ${ref})`,
    body: [
      `${input.nickname}님, 안녕하세요.`,
      '',
      `${when}에 아래 ${kind} 광고를 등록하시면서 「${terms.title}」에 동의하셨습니다. 이 메일은 동의하신 사실과 내용을 확인해 드리기 위해 자동으로 발송되었습니다. 나중에 확인하실 수 있도록 보관해 주세요.`,
      '',
      '■ 광고 정보',
      ...adLines,
      '',
      '■ 동의 정보',
      `- 동의 일시: ${when} (한국 시간)`,
      `- 접속 IP: ${input.ip ?? '-'}`,
      '',
      '■ 동의하신 내용 (전문)',
      terms.text.trimEnd(),
      '',
      '본인이 등록하지 않은 광고라면 즉시 비밀번호를 바꾸고 고객센터로 알려 주세요.',
      '이 메일은 발신 전용입니다.',
    ].join('\n'),
  };
}
