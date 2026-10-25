import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { WalletService } from '../wallet/wallet.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { amountString, parse } from './validation';

const addAddressBody = z.object({
  asset: z.string(),
  address: z.string().max(200),
  label: z.string().max(40).optional(),
});
const withdrawBody = z.object({ addressId: z.uuid(), amount: amountString });
const uuid = new ParseUUIDPipe({ version: '4' });

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

  @Post('addresses')
  async addAddress(@CurrentUser() userId: string, @Body() body: unknown) {
    return { address: await this.wallet.addAddress(userId, parse(addAddressBody, body)) };
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  async removeAddress(@CurrentUser() userId: string, @Param('id', uuid) id: string) {
    await this.wallet.removeAddress(userId, id);
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
  async cancel(@CurrentUser() userId: string, @Param('id', uuid) id: string) {
    return { withdrawal: await this.wallet.cancel(id, userId) };
  }
}
