export interface AppConfig {
  databaseUrl: string;
  port: number;
  makerFeeBps: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const makerFeeBps = Number(env.MAKER_FEE_BPS ?? 0);
  if (!Number.isInteger(makerFeeBps) || makerFeeBps < 0 || makerFeeBps > 1000) {
    throw new Error('MAKER_FEE_BPS must be an integer between 0 and 1000');
  }
  return { databaseUrl, port: Number(env.PORT ?? 3000), makerFeeBps };
}
