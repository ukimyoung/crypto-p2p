/**
 * What each notification says in an email. The web app renders in-app
 * notifications itself from `type` and `data`, in the viewer's language.
 */
export type NotificationType =
  | 'order.created'
  | 'order.paid'
  | 'order.completed'
  | 'order.cancelled'
  | 'order.under_review'
  | 'order.message'
  | 'withdrawal.approved'
  | 'withdrawal.rejected'
  | 'withdrawal.sent'
  | 'withdrawal.confirmed'
  | 'withdrawal.failed'
  | 'account.status_changed'
  | 'fee.invoice_issued'
  | 'fee.invoice_due_soon'
  | 'fee.invoice_overdue'
  | 'fee.invoice_paid';

export type Locale = 'ko' | 'en';

type Data = Record<string, string | null | undefined>;

interface Template {
  subject: (d: Data) => string;
  body: (d: Data) => string;
}

const orderRef = (d: Data) => (d.orderId ?? '').slice(0, 8);

/** Fiat amounts in fee notifications are minor-unit strings; KRW has no minor unit. */
const money = (d: Data, locale: Locale) => {
  const n = Number(d.amountMinor ?? 0) / (d.fiat === 'KRW' ? 1 : 100);
  return locale === 'ko' && d.fiat === 'KRW' ? `${n.toLocaleString('ko-KR')}원` : `${n.toLocaleString('en-US')} ${d.fiat}`;
};
/** Due date (end of the day, Korea time) as YYYY-MM-DD. */
const dueDate = (d: Data) =>
  d.dueAt ? new Date(new Date(d.dueAt).getTime() - 1).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : '-';

/** Types not listed here are in-app only (chat messages, for instance). */
const EMAIL: Partial<Record<NotificationType, Record<Locale, Template>>> = {
  'order.created': {
    ko: {
      subject: (d) => `[P2P] 새 주문이 들어왔습니다 (${orderRef(d)})`,
      body: (d) => `광고에 ${d.amount} ${d.asset} 주문이 들어왔습니다. 결제 기한 안에 진행 상황을 확인해 주세요.`,
    },
    en: {
      subject: (d) => `[P2P] New order on your ad (${orderRef(d)})`,
      body: (d) => `Someone ordered ${d.amount} ${d.asset} from your ad. Please follow it before the payment deadline.`,
    },
  },
  'order.paid': {
    ko: {
      subject: (d) => `[P2P] 구매자가 이체 완료를 표시했습니다 (${orderRef(d)})`,
      body: () =>
        '은행 앱에서 입금을 직접 확인한 뒤에만 코인을 전달하세요. 입금자명이 다르거나 금액이 다르면 전달하지 말고 운영팀에 문의하세요.',
    },
    en: {
      subject: (d) => `[P2P] The buyer marked the order as paid (${orderRef(d)})`,
      body: () =>
        'Release the coins only after you see the money in your bank account. If the sender name or amount differs, do not release and contact support.',
    },
  },
  'order.completed': {
    ko: {
      subject: (d) => `[P2P] 거래가 완료되었습니다 (${orderRef(d)})`,
      body: (d) => `${d.amount} ${d.asset} 거래가 완료되었습니다.`,
    },
    en: {
      subject: (d) => `[P2P] Trade completed (${orderRef(d)})`,
      body: (d) => `The trade for ${d.amount} ${d.asset} is complete.`,
    },
  },
  'order.cancelled': {
    ko: {
      subject: (d) => `[P2P] 주문이 취소되었습니다 (${orderRef(d)})`,
      body: (d) => `${d.amount} ${d.asset} 주문이 취소되었습니다. 잠겨 있던 코인은 판매자에게 돌아갔습니다.`,
    },
    en: {
      subject: (d) => `[P2P] Order cancelled (${orderRef(d)})`,
      body: (d) => `The order for ${d.amount} ${d.asset} was cancelled. The locked coins went back to the seller.`,
    },
  },
  'order.under_review': {
    ko: {
      subject: (d) => `[P2P] 주문이 운영 검토로 넘어갔습니다 (${orderRef(d)})`,
      body: () => '운영팀이 거래 내용을 확인합니다. 주문 채팅에 이체 확인증 등 증빙을 남겨 주세요.',
    },
    en: {
      subject: (d) => `[P2P] Order sent to review (${orderRef(d)})`,
      body: () => 'Our team will look into this trade. Please add evidence, such as a transfer receipt, in the order chat.',
    },
  },
  'withdrawal.rejected': {
    ko: {
      subject: () => '[P2P] 출금이 거절되었습니다',
      body: (d) => `${d.amount} ${d.asset} 출금이 거절되어 잔고로 돌려드렸습니다. 사유: ${d.note ?? '-'}`,
    },
    en: {
      subject: () => '[P2P] Withdrawal rejected',
      body: (d) => `Your withdrawal of ${d.amount} ${d.asset} was rejected and returned to your balance. Reason: ${d.note ?? '-'}`,
    },
  },
  'withdrawal.sent': {
    ko: {
      subject: () => '[P2P] 출금을 전송했습니다',
      body: (d) => `${d.amount} ${d.asset}을(를) ${d.address} 주소로 보냈습니다. 거래 해시: ${d.txHash}`,
    },
    en: {
      subject: () => '[P2P] Withdrawal sent',
      body: (d) => `We sent ${d.amount} ${d.asset} to ${d.address}. Transaction: ${d.txHash}`,
    },
  },
  'withdrawal.failed': {
    ko: {
      subject: () => '[P2P] 출금이 실패했습니다',
      body: (d) => `${d.amount} ${d.asset} 출금을 보내지 못해 잔고로 돌려드렸습니다.`,
    },
    en: {
      subject: () => '[P2P] Withdrawal failed',
      body: (d) => `We could not send your withdrawal of ${d.amount} ${d.asset}. It is back in your balance.`,
    },
  },
  'account.status_changed': {
    ko: {
      subject: () => '[P2P] 계정 이용이 변경되었습니다',
      body: () => '계정 이용 상태가 변경되었습니다. 자세한 내용은 고객센터로 문의해 주세요.',
    },
    en: {
      subject: () => '[P2P] Your account access changed',
      body: () => 'The status of your account changed. Please contact support for details.',
    },
  },
  'fee.invoice_issued': {
    ko: {
      subject: () => '[P2P] 광고 수수료 청구서가 발행되었습니다',
      body: (d) => `광고 수수료 ${money(d, 'ko')}이 청구되었습니다. 납부 기한: ${dueDate(d)}. 기한까지 납부하지 않으면 광고가 노출되지 않습니다.`,
    },
    en: {
      subject: () => '[P2P] New ad fee invoice',
      body: (d) => `You have an ad fee invoice for ${money(d, 'en')}, due ${dueDate(d)}. If it is not paid by then, your ads are hidden.`,
    },
  },
  'fee.invoice_due_soon': {
    ko: {
      subject: () => '[P2P] 광고 수수료 납부 기한이 다가옵니다',
      body: (d) => `미납 광고 수수료 ${money(d, 'ko')}의 납부 기한은 ${dueDate(d)}입니다. 기한이 지나면 광고가 노출되지 않습니다.`,
    },
    en: {
      subject: () => '[P2P] Ad fee due soon',
      body: (d) => `${money(d, 'en')} in ad fees is due ${dueDate(d)}. After that, your ads are hidden.`,
    },
  },
  'fee.invoice_overdue': {
    ko: {
      subject: () => '[P2P] 광고 수수료가 연체되었습니다',
      body: (d) => `광고 수수료 ${money(d, 'ko')}이 납부 기한을 넘겼습니다. 완납할 때까지 광고가 노출되지 않고 새 광고를 등록할 수 없습니다.`,
    },
    en: {
      subject: () => '[P2P] Ad fee overdue',
      body: (d) => `${money(d, 'en')} in ad fees is past due. Until it is paid, your ads are hidden and you cannot post new ones.`,
    },
  },
  'fee.invoice_paid': {
    ko: {
      subject: () => '[P2P] 광고 수수료 납부가 확인되었습니다',
      body: () => '광고 수수료 납부를 확인했습니다. 감사합니다.',
    },
    en: {
      subject: () => '[P2P] Ad fee payment received',
      body: () => 'We received your ad fee payment. Thank you.',
    },
  },
};

export function renderEmail(
  type: NotificationType,
  locale: Locale,
  data: Data,
): { subject: string; body: string } | null {
  const t = EMAIL[type]?.[locale];
  return t ? { subject: t.subject(data), body: t.body(data) } : null;
}
