import { AdSide, adTerms, TermsLocale } from './ad-terms';

/**
 * The confirmation email sent when a member posts an ad: what they agreed to, on which ad, when and
 * from where. Both the plain-text and the HTML version are queued in `email_outbox` exactly as they
 * go out, so that row is the record of what was sent.
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

export interface RenderedEmail {
  subject: string;
  /** Plain text, for mail apps that do not show HTML. */
  body: string;
  html: string;
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Everything both versions show, already in the member's language. */
interface Content {
  subject: string;
  preheader: string;
  badge: string;
  headline: string;
  subline: string;
  greeting: string;
  intro: string;
  adTitle: string;
  adRows: [string, string][];
  agreementTitle: string;
  agreementRows: [string, string][];
  termsTitle: string;
  termsName: string;
  clauses: { heading: string; body: string }[];
  agreed: string;
  warningTitle: string;
  warning: string;
  footer: string;
}

function content(input: AdAgreementEmailInput): Content {
  const terms = adTerms(input.side, input.locale);
  const ref = adRef(input.adId);
  const { asset } = input;
  const pm = input.paymentMethod;
  const bank = pm ? (BANKS[pm.bankCode]?.[input.locale] ?? pm.bankCode) : null;
  const account = pm ? `${bank} ****${pm.accountLast4} (${pm.accountHolder})` : null;
  const when = koreaTime(input.agreedAt);
  const sell = input.side === 'sell';

  if (input.locale === 'en') {
    const kind = sell ? 'sell' : 'buy';
    return {
      subject: `[P2P Club] Your ${kind} ad is posted and you agreed to the terms (${asset} · Ad ${ref})`,
      preheader: `Your ${asset} ${kind} ad ${ref} is posted. Here is what you agreed to.`,
      badge: sell ? 'SELL AD' : 'BUY AD',
      headline: `Your ${kind} ad is posted`,
      subline: 'Here is a copy of the terms you agreed to. Please keep this email.',
      greeting: `Hello ${input.nickname},`,
      intro: `On ${when} (Korea time) you posted the ${kind} ad below and agreed to the "${terms.title}". This email was sent automatically to confirm that you agreed and what you agreed to.`,
      adTitle: 'Ad details',
      adRows: [
        ['Ad number', ref],
        ['Coin', asset],
        [`Price per ${asset}`, `${krw(input.priceMinor)} KRW`],
        [sell ? 'Final ad price with fee' : 'Amount you pay with fee', `${krw(input.finalPriceMinor)} KRW`],
        ['Total amount', `${input.totalAmount} ${asset}`],
        ['Limit per order', `${krw(input.minOrderFiatMinor)} – ${krw(input.maxOrderFiatMinor)} KRW`],
        ['Payment window', `${input.paymentWindowMinutes} minutes`],
        ...(account ? ([['Account for receiving payment', account]] as [string, string][]) : []),
      ],
      agreementTitle: 'Agreement details',
      agreementRows: [
        ['Agreed at', `${when} (Korea time)`],
        ['IP address', input.ip ?? '-'],
      ],
      termsTitle: 'What you agreed to (full text)',
      termsName: terms.title,
      clauses: terms.clauses,
      agreed: terms.agreement,
      warningTitle: 'Did not post this ad?',
      warning: 'Change your password right away and let our support team know.',
      footer: 'This mailbox is not monitored.',
    };
  }

  const kind = sell ? '팔기' : '사기';
  return {
    subject: `[P2P Club] ${kind} 광고 등록 및 서비스 이용 동의 확인 (${asset} · 광고번호 ${ref})`,
    preheader: `${asset} ${kind} 광고(${ref})가 등록되었습니다. 동의하신 내용을 확인해 주세요.`,
    badge: sell ? '팔기 광고' : '사기 광고',
    headline: `${kind} 광고가 등록되었습니다`,
    subline: '동의하신 서비스 이용 동의 내용을 보내 드립니다. 이 메일을 보관해 주세요.',
    greeting: `${input.nickname}님, 안녕하세요.`,
    intro: `${when}에 아래 ${kind} 광고를 등록하시면서 「${terms.title}」에 동의하셨습니다. 이 메일은 동의하신 사실과 내용을 확인해 드리기 위해 자동으로 발송되었습니다.`,
    adTitle: '광고 정보',
    adRows: [
      ['광고 번호', ref],
      ['코인', asset],
      [`1 ${asset} 가격`, `${krw(input.priceMinor)}원`],
      [sell ? '수수료 포함 최종 광고 가격' : '수수료 포함 실제 입금 가격', `${krw(input.finalPriceMinor)}원`],
      ['총 수량', `${input.totalAmount} ${asset}`],
      ['주문당 한도', `${krw(input.minOrderFiatMinor)}원 ~ ${krw(input.maxOrderFiatMinor)}원`],
      ['결제 기한', `${input.paymentWindowMinutes}분`],
      ...(account ? ([['입금받을 계좌', account]] as [string, string][]) : []),
    ],
    agreementTitle: '동의 정보',
    agreementRows: [
      ['동의 일시', `${when} (한국 시간)`],
      ['접속 IP', input.ip ?? '-'],
    ],
    termsTitle: '동의하신 내용 (전문)',
    termsName: terms.title,
    clauses: terms.clauses,
    agreed: terms.agreement,
    warningTitle: '본인이 등록하지 않은 광고인가요?',
    warning: '즉시 비밀번호를 바꾸고 고객센터로 알려 주세요.',
    footer: '이 메일은 발신 전용입니다.',
  };
}

function renderText(c: Content): string {
  const rows = (list: [string, string][]) => list.map(([k, v]) => `- ${k}: ${v}`);
  const clauses = c.clauses.map((cl, i) => `${i + 1}. ${cl.heading}\n${cl.body}`).join('\n\n');
  return [
    c.greeting,
    '',
    `${c.intro}`,
    '',
    `■ ${c.adTitle}`,
    ...rows(c.adRows),
    '',
    `■ ${c.agreementTitle}`,
    ...rows(c.agreementRows),
    '',
    `■ ${c.termsTitle}`,
    c.termsName,
    '',
    clauses,
    '',
    c.agreed,
    '',
    `${c.warningTitle} ${c.warning}`,
    c.footer,
  ].join('\n');
}

const FONT = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',Arial,sans-serif";

/** A section with a coloured panel and a title. Values are already escaped. */
function panel(icon: string, title: string, inner: string, colors: { bg: string; border: string; title: string }): string {
  return `
<tr><td style="padding:0 32px 20px 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${colors.bg};border:1px solid ${colors.border};border-radius:10px;">
    <tr><td style="padding:18px 20px;">
      <p style="margin:0 0 12px 0;font-size:16px;line-height:1.4;font-weight:700;color:${colors.title};">${icon} ${title}</p>
      ${inner}
    </td></tr>
  </table>
</td></tr>`;
}

function rowsTable(rows: [string, string][]): string {
  const trs = rows
    .map(
      ([k, v], i) => `
      <tr>
        <td valign="top" style="padding:7px 12px 7px 0;${i ? 'border-top:1px solid #dbe5e0;' : ''}font-size:14px;line-height:1.5;color:#5b6862;width:42%;">${escapeHtml(k)}</td>
        <td valign="top" style="padding:7px 0;${i ? 'border-top:1px solid #dbe5e0;' : ''}font-size:14px;line-height:1.5;color:#1d2420;font-weight:700;word-break:break-all;">${escapeHtml(v)}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>`;
}

function renderHtml(c: Content, side: AdSide, locale: TermsLocale): string {
  const sideColor = side === 'sell' ? '#d9434b' : '#0b8f62';
  const clauses = c.clauses
    .map(
      (cl, i) => `
      <tr><td style="padding:${i ? '14px' : '0'} 0 0 0;">
        <p style="margin:0 0 4px 0;font-size:14px;line-height:1.5;font-weight:700;color:#1d2420;">${i + 1}. ${escapeHtml(cl.heading)}</p>
        <p style="margin:0;font-size:13.5px;line-height:1.7;color:#3a443f;">${escapeHtml(cl.body)}</p>
      </td></tr>`,
    )
    .join('');
  const terms = `
      <p style="margin:0 0 14px 0;font-size:14px;font-weight:700;color:#3a443f;">${escapeHtml(c.termsName)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${clauses}</table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
        <tr><td style="background-color:#e2f1eb;border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.6;font-weight:700;color:#075a43;">&#9745; ${escapeHtml(c.agreed)}</td></tr>
      </table>`;

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f5f4;font-family:${FONT};color:#1d2420;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f5f4;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e1e6e3;border-radius:14px;overflow:hidden;">
      <tr><td style="background-color:#0b7356;padding:28px 32px;">
        <p style="margin:0 0 6px 0;font-size:14px;font-weight:700;color:#bfe3d5;letter-spacing:0.2px;">P2P Club</p>
        <span style="display:inline-block;margin:0 0 14px 0;padding:5px 12px;border-radius:999px;background-color:${sideColor};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(c.badge)}</span>
        <h1 style="margin:0 0 8px 0;font-size:24px;line-height:1.35;font-weight:700;color:#ffffff;">${escapeHtml(c.headline)}</h1>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#d7efe6;">${escapeHtml(c.subline)}</p>
      </td></tr>
      <tr><td style="padding:28px 32px 20px 32px;">
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.7;color:#1d2420;font-weight:700;">${escapeHtml(c.greeting)}</p>
        <p style="margin:0;font-size:15px;line-height:1.7;color:#3a443f;">${escapeHtml(c.intro)}</p>
      </td></tr>
      ${panel('&#128203;', escapeHtml(c.adTitle), rowsTable(c.adRows), { bg: '#f1f7f4', border: '#d3e6dc', title: '#075a43' })}
      ${panel('&#9989;', escapeHtml(c.agreementTitle), rowsTable(c.agreementRows), { bg: '#eef4ff', border: '#cfdcf7', title: '#1e3a8a' })}
      ${panel('&#128196;', escapeHtml(c.termsTitle), terms, { bg: '#ffffff', border: '#e1e6e3', title: '#1d2420' })}
      ${panel('&#9888;&#65039;', escapeHtml(c.warningTitle), `<p style="margin:0;font-size:14px;line-height:1.6;color:#7f5600;">${escapeHtml(c.warning)}</p>`, { bg: '#fff6df', border: '#f1dfa8', title: '#7f5600' })}
      <tr><td style="padding:4px 32px 28px 32px;font-size:12px;line-height:1.6;color:#8a938e;">
        ${escapeHtml(c.footer)} <a href="https://p2pclub.biz" target="_blank" style="color:#8a938e;text-decoration:underline;">p2pclub.biz</a><br>&copy; P2P Club
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`;
}

export function renderAdAgreementEmail(input: AdAgreementEmailInput): RenderedEmail {
  const c = content(input);
  return { subject: c.subject, body: renderText(c), html: renderHtml(c, input.side, input.locale) };
}
