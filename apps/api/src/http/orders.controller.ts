import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { DomainError } from '../common/errors';
import { OrdersService } from '../orders/orders.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { amountString, parse } from './validation';

const createBody = z.object({ adId: z.uuid(), amount: amountString });
const releaseBody = z.object({ otp: z.string() });
const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  async mine(@CurrentUser() userId: string) {
    return { orders: await this.orders.listForUser(userId) };
  }

  @Post()
  async create(@CurrentUser() userId: string, @Body() body: unknown) {
    const { adId, amount } = parse(createBody, body);
    await this.auth.assertOtpEnabled(userId);
    return { order: await this.orders.create(userId, adId, amount) };
  }

  @Get(':id')
  async get(@CurrentUser() userId: string, @Param('id', uuid) id: string) {
    const order = await this.orders.get(id);
    // Hide other people's orders entirely.
    if (!order || (order.buyerId !== userId && order.sellerId !== userId)) {
      throw new DomainError('not_found', 'Order not found');
    }
    return { order };
  }

  @Post(':id/paid')
  @HttpCode(200)
  async markPaid(@CurrentUser() userId: string, @Param('id', uuid) id: string) {
    return { order: await this.orders.markPaid(id, userId) };
  }

  /** Releasing coins is irreversible, so it needs a fresh OTP code (AUTH-3). */
  @Post(':id/release')
  @HttpCode(200)
  async release(@CurrentUser() userId: string, @Param('id', uuid) id: string, @Body() body: unknown) {
    const { otp } = parse(releaseBody, body);
    await this.auth.verifyOtp(userId, otp);
    return { order: await this.orders.release(id, userId) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() userId: string, @Param('id', uuid) id: string) {
    return { order: await this.orders.cancel(id, userId) };
  }

  @Post(':id/escalate')
  @HttpCode(200)
  async escalate(@CurrentUser() userId: string, @Param('id', uuid) id: string) {
    return { order: await this.orders.escalate(id, userId) };
  }
}
