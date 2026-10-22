/** Per-asset withdrawal rules. All amounts are in the asset's smallest unit. */
export interface AssetWithdrawalRules {
  /** Network fee charged on top of the amount. */
  fee: bigint;
  minAmount: bigint;
  /** Requests up to this amount skip operator review. 0 sends everything to review. */
  autoApproveMax: bigint;
  /** Rolling 24-hour limit by KYC level. A level that is missing cannot withdraw. */
  dailyLimitByKycLevel: Record<number, bigint>;
}

export interface WalletConfig {
  assets: Record<string, AssetWithdrawalRules>;
  /** Hours before a newly whitelisted address can receive withdrawals. */
  addressCooldownHours: number;
}

const BTC = 100_000_000n;
const ETH = 10n ** 18n;
const USDT = 1_000_000n;

/**
 * Placeholder numbers until compliance and finance set the real ones.
 * Limits are per asset for now; a KRW-equivalent limit needs the price feed.
 */
export const DEFAULT_WALLET_CONFIG: WalletConfig = {
  addressCooldownHours: 24,
  assets: {
    BTC: {
      fee: BTC / 5_000n, // 0.0002
      minAmount: BTC / 2_000n, // 0.0005
      autoApproveMax: BTC / 10n,
      dailyLimitByKycLevel: { 1: BTC, 2: 10n * BTC },
    },
    ETH: {
      fee: ETH / 500n, // 0.002
      minAmount: ETH / 100n,
      autoApproveMax: 2n * ETH,
      dailyLimitByKycLevel: { 1: 20n * ETH, 2: 200n * ETH },
    },
    USDT: {
      fee: 5n * USDT,
      minAmount: 10n * USDT,
      autoApproveMax: 5_000n * USDT,
      dailyLimitByKycLevel: { 1: 50_000n * USDT, 2: 500_000n * USDT },
    },
  },
};
