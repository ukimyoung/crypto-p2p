export interface Me {
  id: string;
  email: string;
  kycLevel: number;
  status: string;
  otpEnabled: boolean;
  locale: 'ko' | 'en';
}

export interface Ad {
  id: string;
  makerId: string;
  side: 'buy' | 'sell';
  asset: string;
  fiat: string;
  priceMinor: string;
  totalAmount: string;
  remainingAmount: string;
  minOrderFiatMinor: string;
  maxOrderFiatMinor: string;
  paymentWindowMinutes: number;
  minTakerKycLevel: number;
}

export interface Order {
  id: string;
  adId: string;
  makerId: string;
  buyerId: string;
  sellerId: string;
  asset: string;
  fiat: string;
  priceMinor: string;
  amount: string;
  fiatAmountMinor: string;
  feeAmount: string;
  escrowAmount: string;
  status: 'pending_payment' | 'paid' | 'completed' | 'cancelled' | 'under_review';
  paymentDeadline: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt?: string;
}

export interface PaymentMethod {
  id: string;
  fiat: string;
  bankCode: string;
  accountHolder: string;
  accountMasked: string;
  usableFrom: string;
}

export interface PaymentDetails {
  bankCode: string;
  accountHolder: string;
  accountNumber: string;
}

export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface Balance {
  asset: string;
  available: string;
  escrow: string;
  withdrawalPending: string;
}

export interface WithdrawalAddress {
  id: string;
  asset: string;
  address: string;
  label: string;
  usableFrom: string;
  createdAt: string;
}

export type WithdrawalStatus = 'requested' | 'approved' | 'sent' | 'confirmed' | 'rejected' | 'cancelled' | 'failed';

export interface Withdrawal {
  id: string;
  userId: string;
  asset: string;
  addressId: string;
  address: string;
  amount: string;
  fee: string;
  status: WithdrawalStatus;
  txHash: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export interface WithdrawalLimit {
  asset: string;
  fee: string;
  minAmount: string;
  dailyLimit: string | null;
  usedToday: string;
}

export interface Operator {
  id: string;
  email: string;
  name: string;
  role: 'reviewer' | 'admin';
  /** Sensitive actions are unlocked until this time. */
  stepUpUntil: string | null;
}

export interface UserSummary {
  id: string;
  email: string | null;
  legalName: string | null;
  kycLevel: number;
  status: 'active' | 'trade_suspended' | 'withdraw_held' | 'closed';
  statusReason: string | null;
  otpEnabled: boolean;
  createdAt: string;
}

export interface DisputeResolution {
  id: string;
  orderId: string;
  decision: 'release' | 'refund';
  reason: string;
  status: 'proposed' | 'approved' | 'declined';
  proposedBy: string;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface AuditEntry {
  id: string;
  actorType: 'user' | 'operator' | 'system';
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  data: Record<string, string | null>;
  createdAt: string;
  readAt: string | null;
}

/** Withdrawal rules for one coin. Amounts are in the coin's smallest unit. */
export interface WithdrawalRules {
  asset: string;
  fee: string;
  minAmount: string;
  autoApproveMax: string;
  /** Rolling 24-hour limit keyed by KYC level. A missing level cannot withdraw. */
  dailyLimitByKycLevel: Record<string, string>;
}
