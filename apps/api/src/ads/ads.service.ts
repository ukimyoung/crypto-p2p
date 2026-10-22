import { DomainError } from '../common/errors';
import { writeAudit } from '../common/audit';
import { Db, withTransaction } from '../db/database';
import { PaymentMethodsService } from '../payments/payment-methods.service';

export interface CreateAdInput {
  makerId: string;
  side: 'buy' | 'sell';
  asset: string;
  fiat: string;
  /** Fiat minor units per 1 whole coin. Floating prices (AD-3) come with the price feed. */
  priceMinor: bigint;
  totalAmount: bigint;
  minOrderFiatMinor: bigint;
  maxOrderFiatMinor: bigint;
  paymentWindowMinutes?: number;
  minTakerKycLevel?: number;
  /** Where buyers send fiat. Required on sell ads; on buy ads the selling taker picks one. */
  paymentMethodId?: string;
}

export interface Ad {
  id: string;
  makerId: string;
  side: 'buy' | 'sell';
  asset: string;
  fiat: string;
  priceMinor: bigint;
  totalAmount: bigint;
  remainingAmount: bigint;
  minOrderFiatMinor: bigint;
  maxOrderFiatMinor: bigint;
  paymentWindowMinutes: number;
  minTakerKycLevel: number;
  status: 'online' | 'offline' | 'closed';
  paymentMethodId: string | null;
}

export class AdsService {
  constructor(
    private readonly db: Db,
    private readonly payments: PaymentMethodsService,
  ) {}

  async create(input: CreateAdInput): Promise<Ad> {
    if (input.totalAmount <= 0n) throw new DomainError('invalid_amount', 'Total amount must be positive');
    if (input.minOrderFiatMinor <= 0n || input.maxOrderFiatMinor < input.minOrderFiatMinor) {
      throw new DomainError('invalid_limits', 'Order limits must satisfy 0 < min <= max');
    }
    if (input.side === 'sell' && !input.paymentMethodId) {
      throw new DomainError('payment_method_required', 'A sell ad needs a bank account to receive payments');
    }
    if (input.side === 'buy' && input.paymentMethodId) {
      throw new DomainError('invalid_request', 'A buy ad pays to the seller, so it takes no payment method');
    }
    return withTransaction(this.db, async (tx) => {
      if (input.paymentMethodId) {
        await this.payments.assertUsable(tx, input.makerId, input.paymentMethodId, input.fiat);
      }
      const { rows } = await tx.query(
        `INSERT INTO ads (maker_id, side, asset, fiat, price_minor, total_amount, remaining_amount,
                          min_order_fiat_minor, max_order_fiat_minor, payment_window_minutes, min_taker_kyc_level,
                          payment_method_id)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          input.makerId,
          input.side,
          input.asset,
          input.fiat,
          input.priceMinor.toString(),
          input.totalAmount.toString(),
          input.minOrderFiatMinor.toString(),
          input.maxOrderFiatMinor.toString(),
          input.paymentWindowMinutes ?? 15,
          input.minTakerKycLevel ?? 1,
          input.paymentMethodId ?? null,
        ],
      );
      const ad = toAd(rows[0]);
      await writeAudit(tx, { type: 'user', id: input.makerId }, 'ad.create', { type: 'ad', id: ad.id }, null, ad);
      return ad;
    });
  }

  /**
   * Market list (AD-1). `side` is the maker's side: a buyer browses `sell` ads.
   * Best price first: cheapest sell ads, highest buy ads.
   */
  async list(filter: { asset: string; fiat: string; side: 'buy' | 'sell'; limit?: number }): Promise<Ad[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM ads
       WHERE asset = $1 AND fiat = $2 AND side = $3 AND status = 'online' AND remaining_amount > 0
       ORDER BY price_minor ${filter.side === 'sell' ? 'ASC' : 'DESC'}, created_at
       LIMIT $4`,
      [filter.asset, filter.fiat, filter.side, Math.min(filter.limit ?? 50, 100)],
    );
    return rows.map(toAd);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAd(row: any): Ad {
  return {
    id: row.id,
    makerId: row.maker_id,
    side: row.side,
    asset: row.asset,
    fiat: row.fiat,
    priceMinor: BigInt(row.price_minor),
    totalAmount: BigInt(row.total_amount),
    remainingAmount: BigInt(row.remaining_amount),
    minOrderFiatMinor: BigInt(row.min_order_fiat_minor),
    maxOrderFiatMinor: BigInt(row.max_order_fiat_minor),
    paymentWindowMinutes: row.payment_window_minutes,
    minTakerKycLevel: row.min_taker_kyc_level,
    status: row.status,
    paymentMethodId: row.payment_method_id,
  };
}
