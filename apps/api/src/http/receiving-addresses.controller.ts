import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ReceivingAddressesService } from '../payments/receiving-addresses.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { parse } from './validation';

const setBody = z.object({ network: z.string(), address: z.string() });

@Controller('receiving-addresses')
@UseGuards(AuthGuard)
export class ReceivingAddressesController {
  constructor(@Inject(ReceivingAddressesService) private readonly addresses: ReceivingAddressesService) {}

  @Get()
  async list(@CurrentUser() userId: string) {
    return { receivingAddresses: await this.addresses.list(userId) };
  }

  @Put(':asset')
  async set(@CurrentUser() userId: string, @Param('asset') asset: string, @Body() body: unknown) {
    return { receivingAddress: await this.addresses.set(userId, { asset, ...parse(setBody, body) }) };
  }

  @Delete(':asset')
  @HttpCode(204)
  async remove(@CurrentUser() userId: string, @Param('asset') asset: string) {
    await this.addresses.remove(userId, asset);
  }
}
