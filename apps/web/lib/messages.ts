/** Korean text for API error codes. Unknown codes fall back to the API's message. */
const ERRORS: Record<string, string> = {
  unauthorized: '로그인이 필요합니다.',
  invalid_credentials: '이메일 또는 비밀번호가 맞지 않습니다.',
  too_many_attempts: '로그인 실패가 많아 잠시 잠겼습니다. 15분 뒤에 다시 시도해 주세요.',
  otp_required: 'OTP 코드를 입력해 주세요.',
  invalid_otp: 'OTP 코드가 맞지 않거나 이미 사용한 코드입니다. 다음 코드를 입력해 주세요.',
  otp_not_enabled: '거래하려면 먼저 내 계정에서 OTP를 등록해 주세요.',
  weak_password: '비밀번호는 10자 이상이고 영문과 숫자를 모두 포함해야 합니다.',
  invalid_email: '이메일 주소 형식이 올바르지 않습니다.',
  email_taken: '이미 가입된 이메일입니다.',
  kyc_required: '본인인증(KYC)을 먼저 완료해 주세요.',
  holder_name_mismatch: '예금주가 본인 실명과 같아야 합니다.',
  invalid_bank: '은행 코드는 숫자 3자리입니다.',
  invalid_account: '계좌번호는 숫자 8~20자리입니다.',
  payment_method_required: '입금받을 계좌를 선택해 주세요.',
  payment_method_cooldown: '새로 등록한 계좌는 24시간 뒤부터 사용할 수 있습니다.',
  payment_method_invalid: '사용할 수 없는 계좌입니다.',
  self_trade: '내 광고로는 거래할 수 없습니다.',
  insufficient_balance: '잔고가 부족합니다.',
  insufficient_ad_amount: '광고의 남은 수량보다 많습니다.',
  outside_order_limits: '광고의 주문 한도 밖의 금액입니다.',
  ad_unavailable: '지금은 거래할 수 없는 광고입니다.',
  payment_window_closed: '결제 기한이 지났습니다.',
  invalid_transition: '현재 주문 상태에서는 할 수 없는 동작입니다.',
  forbidden: '권한이 없습니다.',
  not_found: '찾을 수 없습니다.',
  invalid_message: '메시지는 1~1000자로 입력해 주세요.',
  invalid_address: '주소 형식이 올바르지 않습니다. 코인과 네트워크가 맞는지 확인해 주세요.',
  address_exists: '이미 등록한 주소입니다.',
  address_invalid: '등록된 출금 주소 중에서 선택해 주세요.',
  address_cooldown: '새로 등록한 주소는 24시간 뒤부터 출금할 수 있습니다.',
  asset_unsupported: '출금을 지원하지 않는 코인입니다.',
  below_minimum: '최소 출금 수량보다 적습니다.',
  daily_limit_exceeded: '24시간 출금 한도를 넘습니다.',
  user_restricted: '이 계정은 현재 출금이 제한되어 있습니다. 고객센터에 문의해 주세요.',
  proposal_pending: '이미 결정을 기다리는 제안이 있습니다.',
  two_person_rule: '제안한 사람이 아닌 다른 운영자가 승인해야 합니다.',
};

export function errorText(code: string, fallback: string): string {
  return ERRORS[code] ?? fallback;
}

export const ORDER_STATUS: Record<string, string> = {
  pending_payment: '결제 대기',
  paid: '결제 완료 표시됨',
  completed: '거래 완료',
  cancelled: '취소됨',
  under_review: '운영 검토 중',
};

export const WITHDRAWAL_STATUS: Record<string, string> = {
  requested: '검토 대기',
  approved: '송금 준비',
  sent: '전송됨',
  confirmed: '완료',
  rejected: '거절됨',
  cancelled: '취소됨',
  failed: '실패(환불됨)',
};

export const USER_STATUS: Record<string, string> = {
  active: '정상',
  trade_suspended: '거래 정지',
  withdraw_held: '출금 보류',
  closed: '해지',
};

export const OPERATOR_ROLE: Record<string, string> = {
  support: '상담',
  reviewer: '심사',
  admin: '관리자',
};

/** A few common Korean bank codes (KFTC). */
export const BANKS: Record<string, string> = {
  '004': 'KB국민은행',
  '088': '신한은행',
  '020': '우리은행',
  '081': '하나은행',
  '011': 'NH농협은행',
  '003': 'IBK기업은행',
  '090': '카카오뱅크',
  '092': '토스뱅크',
  '089': '케이뱅크',
};
