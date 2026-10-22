/** Decimals of each supported coin's smallest unit (matches the API's assets table). */
export const ASSETS = {
  BTC: { decimals: 8, network: 'Bitcoin' },
  USDT: { decimals: 6, network: 'Ethereum (ERC-20)' },
  ETH: { decimals: 18, network: 'Ethereum' },
} as const;

export type AssetCode = keyof typeof ASSETS;

/** "0.015" BTC -> 1500000n. Returns null for anything that is not a plain positive decimal. */
export function parseUnits(input: string, decimals: number): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole = '0', frac = ''] = s.split('.');
  if (frac.length > decimals) return null;
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  return value > 0n ? value : null;
}

/** 1500000n BTC -> "0.015". Trailing zeros are dropped. */
export function formatUnits(value: bigint | string, decimals: number): string {
  const v = typeof value === 'string' ? BigInt(value) : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole.toLocaleString('en-US')}.${frac}` : whole.toLocaleString('en-US');
}

/** KRW has no minor unit, so minor units are won. */
export function formatKrw(value: bigint | string, locale: 'ko' | 'en' = 'ko'): string {
  return locale === 'en' ? `${BigInt(value).toLocaleString('en-US')} KRW` : `${BigInt(value).toLocaleString('ko-KR')}원`;
}

/** Fiat cost of `amount` coins at `priceMinor` per whole coin, rounded down like the API. */
export function fiatFor(amount: bigint, priceMinor: bigint, decimals: number): bigint {
  return (amount * priceMinor) / 10n ** BigInt(decimals);
}
