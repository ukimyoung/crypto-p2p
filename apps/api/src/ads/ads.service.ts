import { DomainError } from '../common/errors';
import { writeAudit } from '../common/audit';
import { Db, Tx, withTransaction } from '../db/database';
import { NOT_ON_FEE_HOLD, onFeeHold } from '../fees/billing.service';
import { currentFeeRate, finalPrice } from '../fees/fee-rates';
import { assertCanPostAd, IN_OPEN_MARKET } from '../ops/markets';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { formatUnits } from '../notifications/notify';
import { renderAdAgreementEmail } from './ad-agreement-email';
import { AD_TERMS_VERSION, adTerms, TermsLocale } from './ad-terms';

/** The member's agreement to the ad terms, as the form sends it, plus where the request came from. */
export interface AdAgreementInput {
  termsVersion: string;
  termsHash: string;
  locale: TermsLocale;
  ip?: string;
  userAgent?: string;
}

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
  /**
   * Agreement to the ad terms. The HTTP API always requires it; internal callers (demo seed, tests)
   * may leave it out.
   */
  agreement?: AdAgreementInput;
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
  /** The maker fee rate in force when the ad was posted. Later rate changes leave it alone. */
  feeRateBp: number;
}

/** An ad as the market shows it: the maker's price plus the fee, and the maker's nickname. */
export interface MarketAd extends Ad {
  finalPriceMinor: bigint;
  makerNickname: string;
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
    const terms = input.agreement ? adTerms(input.side, input.agreement.locale) : null;
    if (
      terms &&
      (input.agreement!.termsVersion !== AD_TERMS_VERSION || input.agreement!.termsHash !== terms.hash)
    ) {
      throw new DomainError('terms_outdated', 'The ad terms have changed. Reload the page and agree again');
    }
    return withTransaction(this.db, async (tx) => {
      await assertCanPostAd(tx, input.asset, input.fiat);
      if (await onFeeHold(tx, input.makerId)) {
        throw new DomainError('fee_overdue', 'Pay the overdue ad fee before posting a new ad');
      }
      if (input.paymentMethodId) {
        await this.payments.assertUsable(tx, input.makerId, input.paymentMethodId, input.fiat);
      }
      const feeRateBp = await currentFeeRate(tx, input.asset, input.fiat);
      const { rows } = await tx.query(
        `INSERT INTO ads (maker_id, side, asset, fiat, price_minor, total_amount, remaining_amount,
                          min_order_fiat_minor, max_order_fiat_minor, payment_window_minutes, min_taker_kyc_level,
                          payment_method_id, fee_rate_bp)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12)
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
          feeRateBp,
        ],
      );
      const ad = toAd(rows[0]);
      await writeAudit(tx, { type: 'user', id: input.makerId }, 'ad.create', { type: 'ad', id: ad.id }, null, ad);
      if (terms) {
        const agreement = input.agreement!;
        await tx.query(
          `INSERT INTO ad_terms (hash, version, side, locale, body) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (hash) DO NOTHING`,
          [terms.hash, terms.version, terms.side, terms.locale, terms.text],
        );
        const recorded = await tx.query<{ id: string; agreed_at: Date; ip: string | null }>(
          `INSERT INTO ad_agreements (user_id, ad_id, side, terms_version, terms_hash, locale, ip, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, agreed_at, ip`,
          [
            input.makerId,
            ad.id,
            ad.side,
            terms.version,
            terms.hash,
            terms.locale,
            agreement.ip ?? null,
            agreement.userAgent?.slice(0, 1000) ?? null,
          ],
        );
        await this.queueAgreementEmail(tx, ad, terms.locale, recorded.rows[0]!);
      }
      return ad;
    });
  }

  /**
   * Emails the member the terms they just agreed to, with the ad and when and from where they agreed.
   * Queued in the same transaction as the ad, so the email exists exactly when the ad does; the
   * outbox worker sends it and records when it went out.
   */
  private async queueAgreementEmail(
    tx: Tx,
    ad: Ad,
    locale: TermsLocale,
    agreement: { id: string; agreed_at: Date; ip: string | null },
  ): Promise<void> {
    const user = await tx.query<{ email: string | null; nickname: string }>(
      'SELECT email, nickname FROM users WHERE id = $1',
      [ad.makerId],
    );
    const email = user.rows[0]?.email;
    if (!email) return;
    const asset = await tx.query<{ decimals: number }>('SELECT decimals FROM assets WHERE code = $1', [ad.asset]);
    const method = ad.paymentMethodId
      ? await tx.query<{ bank_code: string; account_last4: string; account_holder: string }>(
          'SELECT bank_code, account_last4, account_holder FROM payment_methods WHERE id = $1',
          [ad.paymentMethodId],
        )
      : null;
    const pm = method?.rows[0];
    const { subject, body } = renderAdAgreementEmail({
      side: ad.side,
      locale,
      nickname: user.rows[0]!.nickname,
      adId: ad.id,
      asset: ad.asset,
      totalAmount: formatUnits(ad.totalAmount, asset.rows[0]?.decimals ?? 0),
      priceMinor: ad.priceMinor,
      finalPriceMinor: finalPrice(ad.priceMinor, ad.feeRateBp),
      minOrderFiatMinor: ad.minOrderFiatMinor,
      maxOrderFiatMinor: ad.maxOrderFiatMinor,
      paymentWindowMinutes: ad.paymentWindowMinutes,
      paymentMethod: pm ? { bankCode: pm.bank_code, accountLast4: pm.account_last4, accountHolder: pm.account_holder } : null,
      agreedAt: agreement.agreed_at,
      ip: agreement.ip,
    });
    await tx.query(
      'INSERT INTO email_outbox (ad_agreement_id, to_address, subject, body) VALUES ($1, $2, $3, $4)',
      [agreement.id, email, subject, body],
    );
  }

  /**
   * Market list (AD-1). `side` is the maker's side: a buyer browses `sell` ads.
   * Oldest ad first on both sides, with the id breaking ties so the order is stable.
   * Ads of makers with an overdue fee invoice are left out (FEE-8).
   * Each ad shows the fee rate it was posted with, not today's rate.
   */
  async list(filter: { asset: string; fiat: string; side: 'buy' | 'sell'; limit?: number }): Promise<MarketAd[]> {
    const { rows } = await this.db.query(
      `SELECT ads.*, u.nickname AS maker_nickname FROM ads JOIN users u ON u.id = ads.maker_id
       WHERE asset = $1 AND fiat = $2 AND side = $3 AND ads.status = 'online' AND remaining_amount > 0
         AND ${NOT_ON_FEE_HOLD('ads')} AND ${IN_OPEN_MARKET('ads')}
       ORDER BY ads.created_at, ads.id
       LIMIT $4`,
      [filter.asset, filter.fiat, filter.side, Math.min(filter.limit ?? 50, 100)],
    );
    return rows.map((row) => {
      const ad = toAd(row);
      return { ...ad, finalPriceMinor: finalPrice(ad.priceMinor, ad.feeRateBp), makerNickname: row.maker_nickname };
    });
  }

  /** The maker fee rate in force for a market, for the ad form's price preview. */
  feeRate(asset: string, fiat: string): Promise<number> {
    return currentFeeRate(this.db, asset, fiat);
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
    feeRateBp: row.fee_rate_bp,
  };
}
