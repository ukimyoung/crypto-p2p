import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { parse } from './validation';

const addBody = z.object({
  fiat: z.string(),
  bankCode: z.string(),
  accountHolder: z.string(),
  accountNumber: z.string(),
  otp: z.string(),
});
const removeBody = z.object({ otp: z.string() });

@Controller('payment-methods')
@UseGuards(AuthGuard)
export class PaymentMethodsController {
  constructor(
    @Inject(PaymentMethodsService) private readonly payments: PaymentMethodsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  async list(@CurrentUser() userId: string) {
    return { paymentMethods: await this.payments.list(userId) };
  }

  /** Changing where money is received needs an OTP code (AUTH-3). */
  @Post()
  async add(@CurrentUser() userId: string, @Body() body: unknown) {
    const { otp, ...input } = parse(addBody, body);
    await this.auth.verifyOtp(userId, otp);
    return { paymentMethod: await this.payments.addBankAccount(userId, input) };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    await this.auth.verifyOtp(userId, parse(removeBody, body).otp);
    await this.payments.remove(userId, id);
  }
}
