export interface Me {
  id: string;
  email: string;
  /** Public name other members see, e.g. as the advertiser on the market. */
  nickname: string;
  /** True while the member still has the placeholder nickname given to accounts made before nicknames were asked. */
  temporaryNickname: boolean;
  /** Name typed at signup. Null for members who joined before it was asked. */
  firstName: string | null;
  lastName: string | null;
  kycLevel: number;
  status: string;
  locale: 'ko' | 'en';
  /** +82 10-1234-5678, or null for members who joined before phone numbers were asked. */
  phone: string | null;
  phoneCountry: string | null;
  /** The number in local form (010-1234-5678), for editing. */
  phoneNational: string | null;
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
  /** The advertiser's public nickname. Present on market lists. */
  makerNickname?: string;
}

export interface Order {
  id: string;
  /** Order date in Korea time and a daily sequence, e.g. 202610260001. */
  orderNumber: string;
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

export interface ReceivingAddress {
  id: string;
  asset: string;
  network: string;
  address: string;
  status: 'active' | 'removed';
  createdAt: string;
  removedAt: string | null;
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
  network: string;
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
  network: string;
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
  role: OperatorRole;
  /** Sensitive actions are unlocked until this time. */
  stepUpUntil: string | null;
}

export type OperatorRole = 'reviewer' | 'administrator';

/** An operator account on the operator management page. */
export interface OperatorAccount {
  id: string;
  email: string;
  name: string;
  role: OperatorRole;
  status: 'active' | 'disabled';
  createdAt: string;
  lastLoginAt: string | null;
}

/** The OTP secret for a new or reset operator account, shown once. */
export interface OperatorOtp {
  otpSecret: string;
  otpauthUrl: string;
}

export interface UserSummary {
  id: string;
  email: string | null;
  /** Public nickname shown on the market. */
  nickname: string;
  /** Masked (010-****-5678) unless revealed. */
  phone: string | null;
  /** Masked (홍*동) unless revealed. */
  legalName: string | null;
  /** Name typed at signup, masked like the legal name. Null for members who joined earlier. */
  firstName: string | null;
  lastName: string | null;
  kycLevel: number;
  status: 'active' | 'trade_suspended' | 'withdraw_held' | 'closed';
  statusReason: string | null;
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
    orderNumber: string;
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
  orderNumber: string;
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
