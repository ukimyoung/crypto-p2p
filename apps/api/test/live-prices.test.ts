import { describe, expect, it } from 'vitest';
import { LivePriceService } from '../src/ops/live-prices';

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe('live prices', () => {
  it('reads the Upbit ticker and rounds to the won', async () => {
    const urls: string[] = [];
    const live = new LivePriceService(async (url) => {
      urls.push(String(url));
      return json([{ market: 'KRW-USDT', trade_price: 1394.5, trade_timestamp: 1_700_000_000_000 }]);
    });
    await expect(live.fetch('USDT', 'KRW')).resolves.toEqual({
      asset: 'USDT',
      fiat: 'KRW',
      priceMinor: 1395n,
      source: 'Upbit',
      tradedAt: new Date(1_700_000_000_000),
    });
    expect(urls).toEqual(['https://api.upbit.com/v1/ticker?markets=KRW-USDT']);
  });

  it('falls back to Bithumb when Upbit fails', async () => {
    const live = new LivePriceService(async (url) =>
      String(url).includes('upbit')
        ? json({ error: { name: 'too_many_requests' } }, 429)
        : json({ status: '0000', data: { closing_price: '5123000', date: '1700000000000' } }),
    );
    await expect(live.fetch('ETH', 'KRW')).resolves.toMatchObject({ priceMinor: 5_123_000n, source: 'Bithumb' });
  });

  it('reports price_unavailable when every exchange fails', async () => {
    const live = new LivePriceService(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(live.fetch('BTC', 'KRW')).rejects.toMatchObject({ code: 'price_unavailable' });
    await expect(live.fetch('BTC', 'USD')).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
