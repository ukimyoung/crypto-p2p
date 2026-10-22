import type { Notification } from './types';
import { ASSETS, AssetCode, formatKrw, formatUnits } from './units';

const coins = (d: Notification['data']) =>
  d.amount && d.asset ? `${formatUnits(d.amount, ASSETS[d.asset as AssetCode]?.decimals ?? 0)} ${d.asset}` : '';

const USER_STATUS_TEXT: Record<string, string> = {
  active: '계정 이용 제한이 풀렸습니다.',
  trade_suspended: '계정의 거래가 정지되었습니다. 고객센터에 문의해 주세요.',
  withdraw_held: '계정의 출금이 보류되었습니다. 고객센터에 문의해 주세요.',
  closed: '계정이 해지되었습니다.',
};

/** One-line text and a link for an in-app notification. */
export function describe(n: Notification): { text: string; href: string | null } {
  const d = n.data;
  const order = d.orderId ? `/orders/${d.orderId}` : null;
  switch (n.type) {
    case 'order.created':
      return { text: `광고에 새 주문이 들어왔습니다: ${coins(d)} (${d.fiatAmountMinor ? formatKrw(d.fiatAmountMinor) : ''})`, href: order };
    case 'order.paid':
      return { text: '구매자가 이체 완료를 표시했습니다. 은행 앱에서 입금을 확인해 주세요.', href: order };
    case 'order.completed':
      return { text: `거래가 완료되었습니다: ${coins(d)}`, href: order };
    case 'order.cancelled':
      return {
        text: d.reason === 'expire' ? `결제 기한이 지나 주문이 취소되었습니다: ${coins(d)}` : `주문이 취소되었습니다: ${coins(d)}`,
        href: order,
      };
    case 'order.under_review':
      return { text: '주문이 운영 검토로 넘어갔습니다. 채팅에 증빙을 남겨 주세요.', href: order };
    case 'order.message':
      return { text: '주문 채팅에 새 메시지가 있습니다.', href: order };
    case 'withdrawal.approved':
      return { text: `출금 검토가 끝나 송금을 준비합니다: ${coins(d)}`, href: '/wallet' };
    case 'withdrawal.rejected':
      return { text: `출금이 거절되어 잔고로 돌려드렸습니다: ${coins(d)}${d.note ? ` (사유: ${d.note})` : ''}`, href: '/wallet' };
    case 'withdrawal.sent':
      return { text: `출금을 전송했습니다: ${coins(d)}`, href: '/wallet' };
    case 'withdrawal.confirmed':
      return { text: `출금이 완료되었습니다: ${coins(d)}`, href: '/wallet' };
    case 'withdrawal.failed':
      return { text: `출금을 보내지 못해 잔고로 돌려드렸습니다: ${coins(d)}`, href: '/wallet' };
    case 'account.status_changed':
      return { text: USER_STATUS_TEXT[d.status ?? ''] ?? '계정 상태가 변경되었습니다.', href: '/account' };
    default:
      return { text: '새 알림이 있습니다.', href: null };
  }
}
