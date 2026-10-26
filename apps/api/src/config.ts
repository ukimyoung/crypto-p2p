export interface AppConfig {
  databaseUrl: string;
  port: number;
  /** 32-byte key, base64. Encrypts secrets at rest (bank account numbers, operator OTP seeds). */
  otpEncryptionKey: string;
  sessionTtlHours: number;
  /** Hours before a newly added bank account can receive payments. */
  paymentMethodCooldownHours: number;
  /** How often unpaid orders are expired. 0 turns the worker off. */
  orderExpiryIntervalSeconds: number;
  /** Hours before a newly whitelisted withdrawal address can be used. */
  addressCooldownHours: number;
  /** Operations console sessions are shorter than customer ones. */
  opsSessionTtlHours: number;
  /** How often queued emails are sent. 0 turns the worker off. */
  emailIntervalSeconds: number;
  /** How often fee invoices are issued and checked for due dates. 0 turns the worker off. */
  billingIntervalSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const otpEncryptionKey = env.OTP_ENCRYPTION_KEY;
  if (!otpEncryptionKey) throw new Error('OTP_ENCRYPTION_KEY is not set');
  return {
    databaseUrl,
    port: Number(env.PORT ?? 3000),
    otpEncryptionKey,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    paymentMethodCooldownHours: Number(env.PAYMENT_METHOD_COOLDOWN_HOURS ?? 0),
    orderExpiryIntervalSeconds: Number(env.ORDER_EXPIRY_INTERVAL_SECONDS ?? 30),
    addressCooldownHours: Number(env.ADDRESS_COOLDOWN_HOURS ?? 24),
    opsSessionTtlHours: Number(env.OPS_SESSION_TTL_HOURS ?? 8),
    emailIntervalSeconds: Number(env.EMAIL_INTERVAL_SECONDS ?? 10),
    billingIntervalSeconds: Number(env.BILLING_INTERVAL_SECONDS ?? 300),
  };
}
