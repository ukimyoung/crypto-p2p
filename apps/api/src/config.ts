export interface AppConfig {
  databaseUrl: string;
  port: number;
  makerFeeBps: number;
  /** 32-byte key, base64. Encrypts OTP secrets at rest. */
  otpEncryptionKey: string;
  sessionTtlHours: number;
  /** Hours before a newly added bank account can receive payments. */
  paymentMethodCooldownHours: number;
  /** How often unpaid orders are expired. 0 turns the worker off. */
  orderExpiryIntervalSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const otpEncryptionKey = env.OTP_ENCRYPTION_KEY;
  if (!otpEncryptionKey) throw new Error('OTP_ENCRYPTION_KEY is not set');
  const makerFeeBps = Number(env.MAKER_FEE_BPS ?? 0);
  if (!Number.isInteger(makerFeeBps) || makerFeeBps < 0 || makerFeeBps > 1000) {
    throw new Error('MAKER_FEE_BPS must be an integer between 0 and 1000');
  }
  return {
    databaseUrl,
    port: Number(env.PORT ?? 3000),
    makerFeeBps,
    otpEncryptionKey,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    paymentMethodCooldownHours: Number(env.PAYMENT_METHOD_COOLDOWN_HOURS ?? 24),
    orderExpiryIntervalSeconds: Number(env.ORDER_EXPIRY_INTERVAL_SECONDS ?? 30),
  };
}
