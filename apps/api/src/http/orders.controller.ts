import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { DomainError } from '../common/errors';
import { OrderChatService } from '../orders/order-chat.service';
import { OrdersService } from '../orders/orders.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { amountString, parse } from './validation';

const createBody = z.object({ adId: z.uuid(), amount: amountString, paymentMethodId: z.uuid().optional() });
const releaseBody = z.object({ otp: z.string() });
const messageBody = z.object({ body: z.string() });
const messagesQuery = z.object({ after: z.string().regex(/^\d+$/).optional() });
const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OrderChatService) private readonly chat: OrderChatService,
  ) {}

  @Get()
  async mine(@CurrentUser() userId: string) {
    return { orders: await this.orders.listForUser(userId) };
  }

  @Post()
  async create(@CurrentUser() userId: string, @Body() body: unknown) {
    const { adId, amount, paymentMethodId } = parse(createBody, body);
    await this.auth.assertOtpEnabled(userId);
    return { order: await this.orders.create(userId, adId, amount, paymentMethodId) };
  }

  @Get(':id')
  async get(@CurrentUser() userId: string, @Param('id', uuid) id: string) {
    const order = await this.orders.get(id);
    // Hide other people's orders entirely.
    if (!order || (order.buyerId !== userId && order.sellerId !== userId)) {
      throw new DomainError('not_found', 'Order not found');
    }
    // The account the buyer pays into, shown only to the two parties while the order is open.
    return { order, paymentDetails: await this.orders.paymentDetails(order, userId) };
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

  @Get(':id/messages')
  async messages(@CurrentUser() userId: string, @Param('id', uuid) id: string, @Query() query: unknown) {
    const { after } = parse(messagesQuery, query);
    return { messages: await this.chat.list(id, userId, after) };
  }

  @Post(':id/messages')
  async postMessage(@CurrentUser() userId: string, @Param('id', uuid) id: string, @Body() body: unknown) {
    return { message: await this.chat.post(id, userId, parse(messageBody, body).body) };
  }
}
