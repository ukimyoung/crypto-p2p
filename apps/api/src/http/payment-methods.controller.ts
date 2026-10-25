import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { parse } from './validation';

const addBody = z.object({
  fiat: z.string(),
  bankCode: z.string(),
  accountHolder: z.string(),
  accountNumber: z.string(),
});
const changeBody = z.object({
  bankCode: z.string(),
  accountHolder: z.string(),
  accountNumber: z.string(),
});

@Controller('payment-methods')
@UseGuards(AuthGuard)
export class PaymentMethodsController {
  constructor(@Inject(PaymentMethodsService) private readonly payments: PaymentMethodsService) {}

  @Get()
  async list(@CurrentUser() userId: string) {
    return { paymentMethods: await this.payments.list(userId) };
  }

  @Post()
  async add(@CurrentUser() userId: string, @Body() body: unknown) {
    return { paymentMethod: await this.payments.addBankAccount(userId, parse(addBody, body)) };
  }

  /** A member has one account; changing it replaces the details. */
  @Put(':id')
  async change(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    return { paymentMethod: await this.payments.changeBankAccount(userId, id, parse(changeBody, body)) };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    await this.payments.remove(userId, id);
  }
}
