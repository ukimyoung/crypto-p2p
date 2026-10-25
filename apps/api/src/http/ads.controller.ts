import { Body, Controller, Get, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdsService } from '../ads/ads.service';
import { AuthService } from '../auth/auth.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { amountString, parse } from './validation';

const side = z.enum(['buy', 'sell']);

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

  @Post()
  @UseGuards(AuthGuard)
  async create(@CurrentUser() userId: string, @Body() body: unknown) {
    const input = parse(createBody, body);
    await this.auth.assertKycVerified(userId);
    return { ad: await this.ads.create({ ...input, makerId: userId }) };
  }
}
