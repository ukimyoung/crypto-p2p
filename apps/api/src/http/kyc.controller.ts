import { Controller, Get, Headers, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { KycService } from '../kyc/kyc.service';
import { AuthGuard, CurrentUser } from './auth.guard';

/** The member's identity verification (KYC-1) and the Sumsub webhook (KYC-2). */
@Controller('kyc')
export class KycController {
  constructor(@Inject(KycService) private readonly kyc: KycService) {}

  @Get()
  @UseGuards(AuthGuard)
  async status(@CurrentUser() userId: string) {
    return this.kyc.status(userId);
  }

  /** A WebSDK access token. The secret key never leaves the server. */
  @Post('token')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async token(@CurrentUser() userId: string) {
    return this.kyc.accessToken(userId);
  }

  /** Signed by Sumsub over the exact body bytes, so the raw body is checked. */
  @Post('sumsub/webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-payload-digest') digest: string | undefined,
    @Headers('x-payload-digest-alg') alg: string | undefined,
  ) {
    const result = await this.kyc.handleWebhook(req.rawBody, digest, alg);
    return { ok: true, duplicate: result.duplicate };
  }
}
