import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { WalletService } from '../wallet/wallet.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { amountString, parse } from './validation';

const setAddressBody = z.object({ network: z.string(), address: z.string().max(200) });
const withdrawBody = z.object({ addressId: z.uuid(), amount: amountString });

@Controller('wallet')
@UseGuards(AuthGuard)
export class WalletController {
  constructor(@Inject(WalletService) private readonly wallet: WalletService) {}

  @Get('balances')
  async balances(@CurrentUser() userId: string) {
    return { balances: await this.wallet.balances(userId) };
  }

  @Get('addresses')
  async addresses(@CurrentUser() userId: string) {
    return { addresses: await this.wallet.listAddresses(userId) };
  }

  /** One address per coin, managed from the account page next to the receiving addresses. */
  @Put('addresses/:asset')
  async setAddress(@CurrentUser() userId: string, @Param('asset') asset: string, @Body() body: unknown) {
    return { address: await this.wallet.setAddress(userId, { asset, ...parse(setAddressBody, body) }) };
  }

  @Delete('addresses/:asset')
  @HttpCode(204)
  async removeAddress(@CurrentUser() userId: string, @Param('asset') asset: string) {
    await this.wallet.removeAddress(userId, asset);
  }

  @Get('withdrawals')
  async withdrawals(@CurrentUser() userId: string) {
    return { withdrawals: await this.wallet.listWithdrawals(userId), limits: await this.wallet.limits(userId) };
  }

  @Post('withdrawals')
  async withdraw(@CurrentUser() userId: string, @Body() body: unknown) {
    const { addressId, amount } = parse(withdrawBody, body);
    return { withdrawal: await this.wallet.requestWithdrawal(userId, addressId, amount) };
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() userId: string, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return { withdrawal: await this.wallet.cancel(id, userId) };
  }
}
