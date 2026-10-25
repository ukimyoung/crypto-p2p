import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { ReceivingAddressesService } from '../payments/receiving-addresses.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { parse } from './validation';

const setBody = z.object({ network: z.string(), address: z.string(), otp: z.string() });
const removeBody = z.object({ otp: z.string() });

@Controller('receiving-addresses')
@UseGuards(AuthGuard)
export class ReceivingAddressesController {
  constructor(
    @Inject(ReceivingAddressesService) private readonly addresses: ReceivingAddressesService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  async list(@CurrentUser() userId: string) {
    return { receivingAddresses: await this.addresses.list(userId) };
  }

  /** Adding or changing where coins are received needs an OTP code, like the bank account. */
  @Put(':asset')
  async set(@CurrentUser() userId: string, @Param('asset') asset: string, @Body() body: unknown) {
    const { otp, ...input } = parse(setBody, body);
    await this.auth.verifyOtp(userId, otp);
    return { receivingAddress: await this.addresses.set(userId, { asset, ...input }) };
  }

  @Delete(':asset')
  @HttpCode(204)
  async remove(@CurrentUser() userId: string, @Param('asset') asset: string, @Body() body: unknown) {
    await this.auth.verifyOtp(userId, parse(removeBody, body).otp);
    await this.addresses.remove(userId, asset);
  }
}
