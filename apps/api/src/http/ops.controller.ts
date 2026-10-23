import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Db } from '../db/database';
import { DisputesService } from '../ops/disputes.service';
import { assertRole, assertStepUp, Operator, OperatorAuthService } from '../ops/operator-auth.service';
import { OpsService } from '../ops/ops.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { DB } from '../tokens';
import { loadWithdrawalRules, updateWithdrawalRules } from '../wallet/wallet-config';
import { WalletService } from '../wallet/wallet.service';
import { CurrentOperator, OpsGuard, OpsRequest } from './ops.guard';
import { parse } from './validation';

const loginBody = z.object({ email: z.string(), password: z.string(), otp: z.string() });
const WITHDRAWAL_STATUSES = ['requested', 'approved', 'sent', 'confirmed', 'rejected', 'cancelled', 'failed'] as const;
const withdrawalQuery = z.object({ status: z.enum(WITHDRAWAL_STATUSES).default('requested') });
const rejectBody = z.object({ note: z.string().trim().min(1).max(500) });
const resolveBody = z.object({ decision: z.enum(['release', 'refund']), reason: z.string() });
const stepUpBody = z.object({ otp: z.string() });
/** Zero or a positive integer in the coin's smallest unit, as a decimal string. */
const units = z
  .string()
  .regex(/^(0|[1-9]\d{0,40})$/, 'must be an integer string')
  .transform((v) => BigInt(v));
const withdrawalRulesBody = z.object({
  fee: units,
  minAmount: units,
  autoApproveMax: units,
  dailyLimits: z.record(z.string().regex(/^\d{1,2}$/), units),
  reason: z.string().max(500),
});
const userQuery = z.object({ q: z.string().max(200).default('') });
const statusBody = z.object({
  status: z.enum(['active', 'trade_suspended', 'withdraw_held', 'closed']),
  reason: z.string().max(500),
});
const auditQuery = z.object({ targetId: z.string().max(100).optional(), actorId: z.uuid().optional() });
const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('ops')
export class OpsAuthController {
  constructor(@Inject(OperatorAuthService) private readonly auth: OperatorAuthService) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request) {
    const { email, password, otp } = parse(loginBody, body);
    return { token: await this.auth.login(email, password, otp, { ip: req.ip, userAgent: req.get('user-agent') }) };
  }
}

/**
 * Operations console API. Reviewers can look and act; admins also manage the system.
 * Moving money and changing limits need a recent OTP step-up. Every action is
 * written to the audit log with the operator's id.
 */
@Controller('ops')
@UseGuards(OpsGuard)
export class OpsController {
  constructor(
    @Inject(OperatorAuthService) private readonly auth: OperatorAuthService,
    @Inject(OpsService) private readonly ops: OpsService,
    @Inject(DisputesService) private readonly disputes: DisputesService,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentMethodsService) private readonly payments: PaymentMethodsService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: OpsRequest) {
    await this.auth.logout(req.token);
  }

  @Get('me')
  me(@CurrentOperator() operator: Operator) {
    return { operator };
  }

  /** A fresh OTP code unlocks sensitive actions on this session for a few minutes. */
  @Post('auth/step-up')
  @HttpCode(200)
  async stepUp(@Req() req: OpsRequest, @Body() body: unknown) {
    return { stepUpUntil: await this.auth.stepUp(req.token, parse(stepUpBody, body).otp) };
  }

  @Get('summary')
  async summary() {
    const { rows } = await this.db.query<{ withdrawals: number; disputes: number }>(
      `SELECT (SELECT count(*)::int FROM withdrawals WHERE status = 'requested') AS withdrawals,
              (SELECT count(*)::int FROM orders WHERE status = 'under_review') AS disputes`,
    );
    return { pendingWithdrawals: rows[0]!.withdrawals, openDisputes: rows[0]!.disputes };
  }

  // Withdrawals ---------------------------------------------------------------

  @Get('withdrawals')
  async withdrawals(@Query() query: unknown) {
    return { withdrawals: await this.wallet.listByStatus(parse(withdrawalQuery, query).status) };
  }

  @Post('withdrawals/:id/approve')
  @HttpCode(200)
  async approveWithdrawal(@CurrentOperator() operator: Operator, @Param('id', uuid) id: string) {
    assertRole(operator, 'reviewer');
    assertStepUp(operator);
    return { withdrawal: await this.wallet.approve(id, operator.id) };
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(200)
  async rejectWithdrawal(@CurrentOperator() operator: Operator, @Param('id', uuid) id: string, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    return { withdrawal: await this.wallet.reject(id, operator.id, parse(rejectBody, body).note) };
  }

  // Disputes ------------------------------------------------------------------

  @Get('disputes')
  async openDisputes() {
    return { disputes: await this.disputes.listOpen() };
  }

  @Get('disputes/:orderId')
  async dispute(@Param('orderId', uuid) orderId: string) {
    const c = await this.disputes.getCase(orderId);
    const operatorIds = c.resolutions.flatMap((r) => [r.proposedBy, r.decidedBy ?? []]).flat();
    return {
      ...c,
      buyer: await this.ops.getUser(c.order.buyerId),
      seller: await this.ops.getUser(c.order.sellerId),
      operatorNames: await this.ops.operatorNames([...new Set(operatorIds)]),
    };
  }

  @Post('disputes/:orderId/resolve')
  @HttpCode(200)
  async resolve(@CurrentOperator() operator: Operator, @Param('orderId', uuid) orderId: string, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    assertStepUp(operator);
    const { decision, reason } = parse(resolveBody, body);
    return this.disputes.resolve(orderId, operator.id, decision, reason);
  }

  // Users ---------------------------------------------------------------------

  @Get('users')
  async searchUsers(@Query() query: unknown) {
    return { users: await this.ops.searchUsers(parse(userQuery, query).q) };
  }

  @Get('users/:id')
  async user(@Param('id', uuid) id: string) {
    const user = await this.ops.getUser(id);
    return {
      user,
      balances: await this.wallet.balances(id),
      orders: await this.orders.listForUser(id),
      withdrawals: await this.wallet.listWithdrawals(id),
      paymentMethods: await this.payments.list(id),
    };
  }

  @Post('users/:id/status')
  @HttpCode(200)
  async setStatus(@CurrentOperator() operator: Operator, @Param('id', uuid) id: string, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    const { status, reason } = parse(statusBody, body);
    if (status === 'closed') assertStepUp(operator);
    return { user: await this.ops.setUserStatus(id, status, reason, operator.id) };
  }

  // Settings ------------------------------------------------------------------

  @Get('settings/withdrawal-rules')
  async withdrawalRules() {
    return { rules: await loadWithdrawalRules(this.db) };
  }

  @Put('settings/withdrawal-rules/:asset')
  async setWithdrawalRules(@CurrentOperator() operator: Operator, @Param('asset') asset: string, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    assertStepUp(operator);
    const input = parse(withdrawalRulesBody, body);
    const dailyLimitByKycLevel = Object.fromEntries(Object.entries(input.dailyLimits).map(([k, v]) => [Number(k), v]));
    return {
      rules: await updateWithdrawalRules(this.db, asset, { ...input, dailyLimitByKycLevel }, operator.id, input.reason),
    };
  }

  @Get('audit')
  async audit(@Query() query: unknown) {
    const entries = await this.ops.audit(parse(auditQuery, query));
    const operatorIds = entries.filter((e) => e.actorType === 'operator' && e.actorId).map((e) => e.actorId!);
    return { entries, operatorNames: await this.ops.operatorNames([...new Set(operatorIds)]) };
  }
}
