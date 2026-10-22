import { Locale, translate } from './locale';
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

/** One-line text and a link for an in-app notification, in the viewer's language. */
export function describe(n: Notification, locale: Locale = 'ko'): { text: string; href: string | null } {
  const d = n.data;
  const t = (ko: string, vars?: Record<string, string>) => translate(locale, ko, vars);
  const order = d.orderId ? `/orders/${d.orderId}` : null;
  const amount = { coins: coins(d) };
  switch (n.type) {
    case 'order.created':
      return {
        text: t('광고에 새 주문이 들어왔습니다: {coins} ({krw})', {
          ...amount,
          krw: d.fiatAmountMinor ? formatKrw(d.fiatAmountMinor, locale) : '',
        }),
        href: order,
      };
    case 'order.paid':
      return { text: t('구매자가 이체 완료를 표시했습니다. 은행 앱에서 입금을 확인해 주세요.'), href: order };
    case 'order.completed':
      return { text: t('거래가 완료되었습니다: {coins}', amount), href: order };
    case 'order.cancelled':
      return {
        text:
          d.reason === 'expire'
            ? t('결제 기한이 지나 주문이 취소되었습니다: {coins}', amount)
            : t('주문이 취소되었습니다: {coins}', amount),
        href: order,
      };
    case 'order.under_review':
      return { text: t('주문이 운영 검토로 넘어갔습니다. 채팅에 증빙을 남겨 주세요.'), href: order };
    case 'order.message':
      return { text: t('주문 채팅에 새 메시지가 있습니다.'), href: order };
    case 'withdrawal.approved':
      return { text: t('출금 검토가 끝나 송금을 준비합니다: {coins}', amount), href: '/wallet' };
    case 'withdrawal.rejected':
      return {
        text:
          t('출금이 거절되어 잔고로 돌려드렸습니다: {coins}', amount) +
          (d.note ? ' ' + t('(사유: {note})', { note: d.note }) : ''),
        href: '/wallet',
      };
    case 'withdrawal.sent':
      return { text: t('출금을 전송했습니다: {coins}', amount), href: '/wallet' };
    case 'withdrawal.confirmed':
      return { text: t('출금이 완료되었습니다: {coins}', amount), href: '/wallet' };
    case 'withdrawal.failed':
      return { text: t('출금을 보내지 못해 잔고로 돌려드렸습니다: {coins}', amount), href: '/wallet' };
    case 'account.status_changed':
      return { text: t(USER_STATUS_TEXT[d.status ?? ''] ?? '계정 상태가 변경되었습니다.'), href: '/account' };
    default:
      return { text: t('새 알림이 있습니다.'), href: null };
  }
}
