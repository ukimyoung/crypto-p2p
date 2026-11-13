import { DomainError } from '../common/errors';

/** A coin price fetched from an exchange's public ticker. */
export interface LivePrice {
  asset: string;
  fiat: string;
  /** Fiat minor units per 1 whole coin, rounded to the nearest won. */
  priceMinor: bigint;
  /** Which exchange the price came from, e.g. "Upbit". */
  source: string;
  /** When the exchange says the price was traded. */
  tradedAt: Date;
}

interface Source {
  name: string;
  url: (asset: string) => string;
  /** The last trade price and its time, or null when the reply has no usable price. */
  read: (body: unknown) => { price: number; at: Date } | null;
}

/**
 * Korean exchanges with public KRW tickers (no API key). Binance has no KRW market, so it is not used.
 * Tried in order; the next one is asked only when the one before fails.
 */
const KRW_SOURCES: Source[] = [
  {
    // GET /v1/ticker?markets=KRW-BTC -> [{ market, trade_price, trade_timestamp, ... }]
    name: 'Upbit',
    url: (asset) => `https://api.upbit.com/v1/ticker?markets=KRW-${asset}`,
    read: (body) => {
      const row = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
      const price = Number(row?.trade_price);
      const at = Number(row?.trade_timestamp ?? row?.timestamp);
      return Number.isFinite(price) ? { price, at: Number.isFinite(at) ? new Date(at) : new Date() } : null;
    },
  },
  {
    // GET /public/ticker/BTC_KRW -> { status: "0000", data: { closing_price: "…", date: "<ms>" } }
    name: 'Bithumb',
    url: (asset) => `https://api.bithumb.com/public/ticker/${asset}_KRW`,
    read: (body) => {
      const b = body as { status?: string; data?: { closing_price?: string; date?: string } } | null;
      if (b?.status !== '0000') return null;
      const price = Number(b.data?.closing_price);
      const at = Number(b.data?.date);
      return Number.isFinite(price) ? { price, at: Number.isFinite(at) ? new Date(at) : new Date() } : null;
    },
  },
];

const TIMEOUT_MS = 5_000;

export class LivePriceService {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** The latest KRW trade price of `asset`, from the first exchange that answers. */
  async fetch(asset: string, fiat: string): Promise<LivePrice> {
    if (fiat !== 'KRW') throw new DomainError('invalid_request', `No live price source for ${fiat}`);
    const failures: string[] = [];
    for (const source of KRW_SOURCES) {
      try {
        const res = await this.fetchFn(source.url(asset), {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const read = source.read(await res.json());
        if (!read || read.price <= 0) throw new Error('no price in reply');
        return { asset, fiat, priceMinor: BigInt(Math.round(read.price)), source: source.name, tradedAt: read.at };
      } catch (err) {
        failures.push(`${source.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new DomainError('price_unavailable', `Could not fetch the ${asset}/${fiat} price (${failures.join('; ')})`);
  }
}
