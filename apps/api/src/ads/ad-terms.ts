import { createHash } from 'node:crypto';

/**
 * Terms a member agrees to on the ad form before posting a sell or buy ad.
 * The server holds the only copy: the form shows what `GET /ads/terms` returns, and the agreement
 * recorded with each ad names the version and the sha256 of the exact text shown.
 *
 * Changing any wording means a new version: bump AD_TERMS_VERSION so earlier agreements keep
 * pointing at the text those members actually saw (it is kept in the `ad_terms` table).
 */
export const AD_TERMS_VERSION = '2026-11-11';

export type AdSide = 'sell' | 'buy';
export type TermsLocale = 'ko' | 'en';

export interface AdTermsClause {
  heading: string;
  body: string;
}

export interface AdTerms {
  version: string;
  side: AdSide;
  locale: TermsLocale;
  title: string;
  clauses: AdTermsClause[];
  /** The checkbox label. */
  agreement: string;
  /** The terms as one plain text, which is what the hash covers and what is stored. */
  text: string;
  /** sha256 of `text`, hex. */
  hash: string;
}

type Wording = Omit<AdTerms, 'version' | 'side' | 'locale' | 'text' | 'hash'>;

const KO_ILLEGAL: AdTermsClause = {
  heading: '불법 자금 금지',
  body: '보이스피싱, 사기, 자금세탁 등 범죄와 관련된 돈이나 코인을 거래하지 않습니다. 의심되는 거래는 보류되고 계정이 제한되거나 수사기관에 신고될 수 있습니다.',
};
const KO_EVIDENCE: AdTermsClause = {
  heading: '기록의 증거 사용',
  body: '주문·입금·채팅 기록과 이 동의 기록(동의 일시, 접속 IP 등)은 분쟁 조정에 쓰이고, 법원·수사기관에 제출될 수 있습니다.',
};
const EN_ILLEGAL: AdTermsClause = {
  heading: 'No illegal funds',
  body: 'I will not trade money or coins connected to crime, such as voice phishing, fraud or money laundering. Suspicious trades may be put on hold, my account may be restricted, and the matter may be reported to the police.',
};
const EN_EVIDENCE: AdTermsClause = {
  heading: 'Records used as evidence',
  body: 'Order, payment and chat records, and this agreement record (when I agreed, my IP address and so on), are used to settle disputes and may be given to courts and investigative agencies.',
};

const WORDING: Record<TermsLocale, Record<AdSide, Wording>> = {
  ko: {
    sell: {
      title: '팔기 광고 등록 서비스 이용 동의',
      clauses: [
        {
          heading: '등록 정보 진실성 보증',
          body: '본인은 P2P Club에 등록한 이름, 이메일, 휴대폰 번호, 입금받을 은행 계좌(예금주 포함), 암호화폐 입출금 주소가 모두 본인의 것이며 허위가 아님을 보증합니다. 허위 정보나 다른 사람 명의 정보로 생긴 손해와 법적 책임은 본인에게 있습니다.',
        },
        {
          heading: '본인 명의 계좌로만 받기',
          body: '구매자의 대금은 본인 명의로 등록한 계좌로만 받으며, 다른 사람 계좌나 플랫폼 밖 방법으로 받지 않습니다.',
        },
        {
          heading: '입금 확인과 코인 전달',
          body: '주문이 들어오면 판매할 코인은 에스크로에 묶입니다. 본인은 입금을 확인하면 지체 없이 코인을 전달하며, 실제로 받은 대금을 받지 않았다고 주장하지 않습니다.',
        },
        {
          heading: '완료된 거래는 환불 불가',
          body: "'입금 확인, 코인 넘기기'로 코인을 넘겨 거래가 완료되면 받은 원화와 넘긴 암호화폐는 되돌릴 수 없으며, 본인은 이에 대해 환불이나 취소를 요구하지 않습니다. 다만 운영팀의 분쟁 결정, 법원·수사기관의 요청이 있으면 그에 따릅니다.",
        },
        KO_ILLEGAL,
        KO_EVIDENCE,
        {
          heading: '수수료',
          body: '광고 수수료는 광고 가격에 더해지며, 거래가 끝난 뒤 원화로 청구됩니다.',
        },
      ],
      agreement: '위 내용을 모두 읽었으며 팔기 광고 서비스 이용에 동의합니다.',
    },
    buy: {
      title: '사기 광고 등록 서비스 이용 동의',
      clauses: [
        {
          heading: '등록 정보 진실성 보증',
          body: '본인은 P2P Club에 등록한 이름, 이메일, 휴대폰 번호, 은행 계좌(예금주 포함), 암호화폐 입출금 주소가 모두 본인의 것이며 허위가 아님을 보증합니다. 허위 정보나 다른 사람 명의 정보로 생긴 손해와 법적 책임은 본인에게 있습니다.',
        },
        {
          heading: '본인 명의 계좌에서 보내기',
          body: '판매자에게 대금은 본인 명의 계좌에서, 주문 화면에 표시된 판매자 계좌로 정확한 금액을 보냅니다. 다른 사람 계좌나 플랫폼 밖 방법으로 보내지 않습니다.',
        },
        {
          heading: '이체 완료 표시',
          body: "실제로 대금을 보낸 뒤에만 '이체 완료'를 누르며, 보내지 않은 대금을 보냈다고 주장하지 않습니다.",
        },
        {
          heading: '완료된 거래는 환불 불가',
          body: '판매자가 코인을 전달해 거래가 완료되면 보낸 원화와 받은 암호화폐는 되돌릴 수 없으며, 본인은 이에 대해 환불이나 취소를 요구하지 않습니다. 다만 운영팀의 분쟁 결정, 법원·수사기관의 요청이 있으면 그에 따릅니다.',
        },
        KO_ILLEGAL,
        KO_EVIDENCE,
        {
          heading: '수수료',
          body: '광고 수수료는 가격에 더해지며, 판매자에게는 수수료를 더한 금액을 보내고 수수료는 거래가 끝난 뒤 원화로 청구됩니다.',
        },
      ],
      agreement: '위 내용을 모두 읽었으며 사기 광고 서비스 이용에 동의합니다.',
    },
  },
  en: {
    sell: {
      title: 'Terms for posting a sell ad',
      clauses: [
        {
          heading: 'True registration details',
          body: 'I guarantee that the name, email, mobile number, bank account for receiving payments (including the account holder) and crypto deposit and withdrawal addresses I registered with P2P Club are all my own and not false. I am responsible for any loss and legal liability caused by false details or details in another person’s name.',
        },
        {
          heading: 'Payments only to my own account',
          body: 'I receive buyers’ payments only into the bank account registered in my own name, never into another person’s account or by any method outside the platform.',
        },
        {
          heading: 'Confirming payment and releasing coins',
          body: 'When an order comes in, the coins I am selling are held in escrow. Once I confirm the payment, I release the coins without delay, and I will not claim that I did not receive a payment I actually received.',
        },
        {
          heading: 'No refunds on completed trades',
          body: 'Once I press “Payment received, release coins” and the trade is completed, the money received and the crypto handed over cannot be reversed, and I will not ask for a refund or cancellation. Decisions by the operations team in a dispute, and requests from courts or investigative agencies, are followed.',
        },
        EN_ILLEGAL,
        EN_EVIDENCE,
        {
          heading: 'Fees',
          body: 'The ad fee is added to the ad price and billed in KRW after the trade ends.',
        },
      ],
      agreement: 'I have read all of the above and agree to the terms for sell ads.',
    },
    buy: {
      title: 'Terms for posting a buy ad',
      clauses: [
        {
          heading: 'True registration details',
          body: 'I guarantee that the name, email, mobile number, bank account (including the account holder) and crypto deposit and withdrawal addresses I registered with P2P Club are all my own and not false. I am responsible for any loss and legal liability caused by false details or details in another person’s name.',
        },
        {
          heading: 'Paying from my own account',
          body: 'I send the exact amount from a bank account in my own name to the seller’s account shown on the order screen, never from another person’s account or by any method outside the platform.',
        },
        {
          heading: 'Marking the payment as sent',
          body: 'I press “I’ve paid” only after I have actually sent the money, and I will not claim to have sent a payment I did not send.',
        },
        {
          heading: 'No refunds on completed trades',
          body: 'Once the seller releases the coins and the trade is completed, the money sent and the crypto received cannot be reversed, and I will not ask for a refund or cancellation. Decisions by the operations team in a dispute, and requests from courts or investigative agencies, are followed.',
        },
        EN_ILLEGAL,
        EN_EVIDENCE,
        {
          heading: 'Fees',
          body: 'The ad fee is added to the price: I send the seller the amount including the fee, and the fee is billed in KRW after the trade ends.',
        },
      ],
      agreement: 'I have read all of the above and agree to the terms for buy ads.',
    },
  },
};

function render(w: Wording): string {
  const clauses = w.clauses.map((c, i) => `${i + 1}. ${c.heading}\n${c.body}`).join('\n\n');
  return `${w.title}\n\n${clauses}\n\n${w.agreement}\n`;
}

export function adTerms(side: AdSide, locale: TermsLocale): AdTerms {
  const wording = WORDING[locale][side];
  const text = render(wording);
  return {
    version: AD_TERMS_VERSION,
    side,
    locale,
    ...wording,
    text,
    hash: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}
