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
  /** Maker fee in 0.01% units (25 = 0.25%). Present on market lists. */
  feeRateBp?: number;
  /** The price buyers see: the maker's price plus the fee. */
  finalPriceMinor?: string;
}

export interface Order {
  id: string;
  adId: string;
  makerId: string;
  buyerId: string;
  sellerId: string;
  asset: string;
  fiat: string;
  /** Final price per coin, with the maker fee. */
  priceMinor: string;
  /** The price the maker entered. */
  basePriceMinor: string;
  amount: string;
  /** What the buyer transfers, fee included. */
  fiatAmountMinor: string;
  feeRateBp: number;
  /** The maker's fee in fiat, billed later. */
  feeFiatMinor: string;
  feeAmount: string;
  escrowAmount: string;
  status: 'pending_payment' | 'paid' | 'completed' | 'cancelled' | 'under_review';
  paymentDeadline: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt?: string;
  reviewSource?: 'buyer' | 'seller' | 'system' | null;
  escalatedAt?: string | null;
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
  /** Masked (010-****-5678) unless revealed. */
  phone: string | null;
  /** Masked (홍*동) unless revealed. */
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

export interface FeeRateChange {
  id: string;
  asset: string | null;
  fiat: string | null;
  rateBp: number | null;
  effectiveFrom: string;
  reason: string;
  createdByEmail: string | null;
  createdAt: string;
}

export interface FeeRateOverview {
  defaultRateBp: number;
  markets: { asset: string; fiat: string; ownRateBp: number | null; rateBp: number }[];
  scheduled: FeeRateChange[];
  history: FeeRateChange[];
}

export interface BillingSettings {
  cycle: 'daily' | 'monthly';
  dueDays: number;
}

export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'overdue';

export interface FeeInvoice {
  id: string;
  makerId: string;
  makerEmail: string | null;
  fiat: string;
  periodStart: string;
  periodEnd: string;
  totalMinor: string;
  paidMinor: string;
  status: InvoiceStatus;
  /** End of the due date. */
  dueAt: string;
  issuedAt: string;
  paidAt: string | null;
}

export interface FeeInvoiceDetail {
  invoice: FeeInvoice;
  orders: {
    id: string;
    asset: string;
    amount: string;
    basePriceMinor: string;
    feeRateBp: number;
    fiatAmountMinor: string;
    feeFiatMinor: string;
    completedAt: string;
  }[];
  payments: { id: string; amountMinor: string; paidAt: string; memo: string; operatorEmail: string | null; createdAt: string }[];
}

export interface UserRow extends UserSummary {
  openOrders: number;
  /** Sumsub review status and answer; null before the member starts identity verification. */
  sumsubStatus: string | null;
  sumsubAnswer: string | null;
  sumsubRejectType: string | null;
}

export interface OpsAd extends Ad {
  status: 'online' | 'offline' | 'closed';
  makerEmail: string;
  createdAt: string;
}

export interface OpsOrder {
  id: string;
  adId: string;
  makerId: string;
  buyerId: string;
  sellerId: string;
  buyerEmail: string | null;
  sellerEmail: string | null;
  asset: string;
  fiat: string;
  priceMinor: string;
  basePriceMinor: string;
  amount: string;
  fiatAmountMinor: string;
  feeRateBp: number;
  feeFiatMinor: string;
  escrowAmount: string;
  status: Order['status'];
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface MarketsOverview {
  assets: { code: string; network: string; decimals: number; status: 'active' | 'ads_paused' | 'withdrawals_paused' | 'delisted' }[];
  markets: {
    asset: string;
    fiat: string;
    status: 'open' | 'paused' | 'closed';
    updatedAt: string;
    onlineAds: number;
    openOrders: number;
  }[];
}

/** The member's identity verification (GET /kyc). */
export interface KycStatus {
  kycLevel: number;
  /** False until Sumsub is set up on the server. */
  available: boolean;
  applicant: {
    reviewStatus: string;
    reviewAnswer: 'GREEN' | 'RED' | null;
    rejectType: 'RETRY' | 'FINAL' | null;
    moderationComment: string | null;
    updatedAt: string;
  } | null;
}

/** The KYC tab of the member detail in the operations console. */
export interface OpsKyc {
  configured: boolean;
  applicant: {
    applicantId: string;
    levelName: string | null;
    reviewStatus: string;
    reviewAnswer: 'GREEN' | 'RED' | null;
    rejectType: 'RETRY' | 'FINAL' | null;
    rejectLabels: string[];
    moderationComment: string | null;
    clientComment: string | null;
    createdAt: string;
    updatedAt: string;
    consoleUrl: string;
  } | null;
  webhooks: { type: string; reviewStatus: string | null; receivedAt: string }[];
}
