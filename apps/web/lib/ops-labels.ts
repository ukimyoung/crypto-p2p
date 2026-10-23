/** Labels used only in the operations console, which stays in Korean. */
export const AD_STATUS: Record<string, string> = {
  online: '노출',
  offline: '비노출',
  closed: '종료',
};

export const ASSET_STATUS: Record<string, string> = {
  active: '거래 가능',
  ads_paused: '신규 광고 중지',
  withdrawals_paused: '출금 중지',
  delisted: '상장 폐지',
};

export const MARKET_STATUS: Record<string, string> = {
  open: '열림',
  paused: '일시 중지',
  closed: '닫힘',
};

/** KYC is either not done or done: Sumsub has a single level. */
export const KYC_LEVEL: Record<number, string> = {
  0: '미인증',
  1: '인증 완료',
};

export const SUMSUB_STATUS: Record<string, string> = {
  init: '제출 전',
  pending: '심사 대기',
  prechecked: '사전 확인',
  queued: '심사 대기열',
  onHold: '보류',
  completed: '심사 완료',
};

/** The review result as one label, from the status, answer and reject type. */
export function sumsubResult(status: string | null, answer: string | null, rejectType?: string | null): string {
  if (!status) return '시작 전';
  if (status !== 'completed') return SUMSUB_STATUS[status] ?? status;
  if (answer === 'GREEN') return '승인';
  if (answer === 'RED') return rejectType === 'FINAL' ? '최종 거절' : rejectType === 'RETRY' ? '재제출 요청' : '거절';
  return SUMSUB_STATUS.completed!;
}
