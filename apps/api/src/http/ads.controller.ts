import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { adTerms } from '../ads/ad-terms';
import { AdsService } from '../ads/ads.service';
import { AuthService } from '../auth/auth.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { amountString, parse } from './validation';

const side = z.enum(['buy', 'sell']);
const locale = z.enum(['ko', 'en']);

const listQuery = z.object({
  asset: z.string(),
  fiat: z.string(),
  side,
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const createBody = z.object({
  side,
  asset: z.string(),
  fiat: z.string(),
  priceMinor: amountString,
  totalAmount: amountString,
  minOrderFiatMinor: amountString,
  maxOrderFiatMinor: amountString,
  paymentWindowMinutes: z.number().int().min(5).max(180).optional(),
  minTakerKycLevel: z.number().int().min(1).max(1).optional(),
  paymentMethodId: z.uuid().optional(),
  /** The member ticked "I agree" under the terms `GET /ads/terms` returned. */
  agreement: z.object({
    agreed: z.literal(true),
    termsVersion: z.string().max(50),
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
    locale,
  }),
});

@Controller('ads')
export class AdsController {
  constructor(
    @Inject(AdsService) private readonly ads: AdsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Public market list. */
  @Get()
  async list(@Query() query: unknown) {
    return { ads: await this.ads.list(parse(listQuery, query)) };
  }

  /** Maker fee rate of a market, in 0.01% units. */
  @Get('fee-rate')
  async feeRate(@Query() query: unknown) {
    const { asset, fiat } = parse(z.object({ asset: z.string(), fiat: z.string() }), query);
    return { asset, fiat, feeRateBp: await this.ads.feeRate(asset, fiat) };
  }

  /** The terms a member agrees to before posting an ad of this side, in their language. */
  @Get('terms')
  terms(@Query() query: unknown) {
    const input = parse(z.object({ side, locale: locale.optional() }), query);
    const terms = adTerms(input.side, input.locale ?? 'ko');
    return {
      terms: {
        version: terms.version,
        side: terms.side,
        locale: terms.locale,
        title: terms.title,
        clauses: terms.clauses,
        agreement: terms.agreement,
        hash: terms.hash,
      },
    };
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(@CurrentUser() userId: string, @Body() body: unknown, @Req() req: Request) {
    const { agreement, ...input } = parse(createBody, body);
    await this.auth.assertKycVerified(userId);
    const ad = await this.ads.create({
      ...input,
      makerId: userId,
      agreement: {
        termsVersion: agreement.termsVersion,
        termsHash: agreement.termsHash,
        locale: agreement.locale,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
    });
    return { ad };
  }
}
