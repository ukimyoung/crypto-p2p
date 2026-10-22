import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { amountString, parse } from './validation';

const addAddressBody = z.object({
  asset: z.string(),
  address: z.string().max(200),
  label: z.string().max(40).optional(),
  otp: z.string(),
});
const otpBody = z.object({ otp: z.string() });
const withdrawBody = z.object({ addressId: z.uuid(), amount: amountString, otp: z.string() });
const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('wallet')
@UseGuards(AuthGuard)
export class WalletController {
  constructor(
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get('balances')
  async balances(@CurrentUser() userId: string) {
    return { balances: await this.wallet.balances(userId) };
  }

  @Get('addresses')
  async addresses(@CurrentUser() userId: string) {
    return { addresses: await this.wallet.listAddresses(userId) };
  }

  /** Changing where coins can be sent needs an OTP code (AUTH-3). */
  @Post('addresses')
  async addAddress(@CurrentUser() userId: string, @Body() body: unknown) {
    const { otp, ...input } = parse(addAddressBody, body);
    await this.auth.verifyOtp(userId, otp);
    return { address: await this.wallet.addAddress(userId, input) };
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  async removeAddress(@CurrentUser() userId: string, @Param('id', uuid) id: string, @Body() body: unknown) {
    await this.auth.verifyOtp(userId, parse(otpBody, body).otp);
    await this.wallet.removeAddress(userId, id);
  }

  @Get('withdrawals')
  async withdrawals(@CurrentUser() userId: string) {
    return { withdrawals: await this.wallet.listWithdrawals(userId), limits: await this.wallet.limits(userId) };
  }

  @Post('withdrawals')
  async withdraw(@CurrentUser() userId: string, @Body() body: unknown) {
    const { addressId, amount, otp } = parse(withdrawBody, body);
    await this.auth.verifyOtp(userId, otp);
    return { withdrawal: await this.wallet.requestWithdrawal(userId, addressId, amount) };
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() userId: string, @Param('id', uuid) id: string) {
    return { withdrawal: await this.wallet.cancel(id, userId) };
  }
}
