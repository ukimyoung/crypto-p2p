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
import { DomainError } from '../common/errors';
import { Db } from '../db/database';
import { BillingService } from '../fees/billing.service';
import { feeRateOverview, MAX_FEE_RATE_BP, setFeeRate } from '../fees/fee-rates';
import { DisputesService } from '../ops/disputes.service';
import { listMarkets, setAssetStatus, setMarketStatus } from '../ops/markets';
import { billingSettings, updateSettings } from '../ops/ops-settings';
import { AD_SORTS, OpsTradesService } from '../ops/ops-trades.service';
import { assertRole, assertStepUp, Operator, OperatorAuthService } from '../ops/operator-auth.service';
import { maskName, OpsService, USER_SORTS } from '../ops/ops.service';
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
const feeRateBody = z.object({
  asset: z.string().max(10).optional(),
  fiat: z.string().max(10).optional(),
  rateBp: z.number().int().min(0).max(MAX_FEE_RATE_BP).nullable(),
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().max(500),
});
const billingBody = z.object({
  cycle: z.enum(['daily', 'monthly']),
  dueDays: z.number().int().min(1).max(60),
  reason: z.string().max(500),
});
const INVOICE_STATUSES = ['issued', 'partially_paid', 'paid', 'overdue'] as const;
const invoiceQuery = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  makerId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});
const paymentBody = z.object({
  amountMinor: z
    .string()
    .regex(/^[1-9]\d{0,40}$/, 'must be a positive integer string')
    .transform((v) => BigInt(v)),
  paidAt: z.iso.datetime({ offset: true }),
  memo: z.string().max(500).default(''),
});
const summaryQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
const USER_STATUSES = ['active', 'trade_suspended', 'withdraw_held', 'closed'] as const;
const dateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((n) => [20, 50, 100].includes(n), 'must be 20, 50 or 100').default(50),
};
const userQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(USER_STATUSES).optional(),
  kycLevel: z.coerce.number().int().min(0).max(3).optional(),
  from: dateTime.optional(),
  to: dateTime.optional(),
  sort: z.enum(USER_SORTS).default('created_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  ...paging,
});
const reasonBody = z.object({ reason: z.string().max(500) });
const kycBody = z.object({ level: z.number().int().min(0).max(3), reason: z.string().max(500) });
const adQuery = z.object({
  asset: z.string().max(10).optional(),
  fiat: z.string().max(10).optional(),
  side: z.enum(['buy', 'sell']).optional(),
  status: z.enum(['online', 'offline', 'closed']).optional(),
  makerId: z.uuid().optional(),
  sort: z.enum(AD_SORTS).default('created_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  ...paging,
});
const adStatusBody = z.object({ status: z.enum(['offline', 'closed']), reason: z.string().max(500) });
const orderQuery = z.object({
  status: z.enum(['pending_payment', 'paid', 'completed', 'cancelled', 'under_review']).optional(),
  asset: z.string().max(10).optional(),
  userId: z.uuid().optional(),
  from: dateTime.optional(),
  to: dateTime.optional(),
  ...paging,
});
const assetStatusBody = z.object({
  status: z.enum(['active', 'ads_paused', 'withdrawals_paused', 'delisted']),
  reason: z.string().max(500),
});
const marketStatusBody = z.object({ status: z.enum(['open', 'paused', 'closed']), reason: z.string().max(500) });
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
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(OpsTradesService) private readonly trades: OpsTradesService,
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
      // Reviewers compare the payer's name with the account holder, so names are shown in full here.
      buyer: await this.ops.getUser(c.order.buyerId, true),
      seller: await this.ops.getUser(c.order.sellerId, true),
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

  /** Member grid: all members by default, filtered, sorted and paged on the server. */
  @Get('users')
  async users(@Query() query: unknown) {
    const q = parse(userQuery, query);
    return { ...(await this.ops.listUsers(q)), page: q.page, pageSize: q.pageSize };
  }

  @Get('users/:id')
  async user(@Param('id', uuid) id: string) {
    const user = await this.ops.getUser(id);
    return {
      user,
      balances: await this.wallet.balances(id),
      orders: await this.orders.listForUser(id),
      withdrawals: await this.wallet.listWithdrawals(id),
      paymentMethods: (await this.payments.list(id)).map((m) => ({ ...m, accountHolder: maskName(m.accountHolder) })),
      ...(await this.ops.userExtras(id)),
    };
  }

  /** Full phone number and legal name. Needs a reason and a step-up, and the viewing is audited. */
  @Post('users/:id/reveal')
  @HttpCode(200)
  async revealUser(@CurrentOperator() operator: Operator, @Param('id', uuid) id: string, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    assertStepUp(operator);
    return { pii: await this.ops.revealUser(id, parse(reasonBody, body).reason, operator.id) };
  }

  @Post('users/:id/kyc-level')
  @HttpCode(200)
  async setKycLevel(@CurrentOperator() operator: Operator, @Param('id', uuid) id: string, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    const { level, reason } = parse(kycBody, body);
    return { user: await this.ops.setKycLevel(id, level, reason, operator.id) };
  }

  // Ads and orders --------------------------------------------------------------

  @Get('ads')
  async ads(@Query() query: unknown) {
    const q = parse(adQuery, query);
    return { ...(await this.trades.listAds(q)), page: q.page, pageSize: q.pageSize };
  }

  @Get('ads/:id')
  async ad(@Param('id', uuid) id: string) {
    return this.trades.getAd(id);
  }

  /** Hides (`offline`) or ends (`closed`) an ad. Open orders carry on. */
  @Post('ads/:id/status')
  @HttpCode(200)
  async setAdStatus(@CurrentOperator() operator: Operator, @Param('id', uuid) id: string, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    const { status, reason } = parse(adStatusBody, body);
    return { ad: await this.trades.setAdStatus(id, status, reason, operator.id) };
  }

  @Get('orders')
  async orderList(@Query() query: unknown) {
    const q = parse(orderQuery, query);
    return { ...(await this.trades.listOrders(q)), page: q.page, pageSize: q.pageSize };
  }

  @Get('orders/:id')
  async order(@Param('id', uuid) id: string) {
    const detail = await this.trades.getOrder(id);
    const operatorIds = detail.history.filter((h) => h.actorType === 'operator' && h.actorId).map((h) => h.actorId!);
    return { ...detail, operatorNames: await this.ops.operatorNames([...new Set(operatorIds)]) };
  }

  // Markets -----------------------------------------------------------------------

  @Get('markets')
  async markets() {
    return listMarkets(this.db);
  }

  @Put('markets/assets/:code')
  async setAssetStatus(@CurrentOperator() operator: Operator, @Param('code') code: string, @Body() body: unknown) {
    assertRole(operator, 'admin');
    const { status, reason } = parse(assetStatusBody, body);
    return { asset: await setAssetStatus(this.db, code, status, reason, operator.id) };
  }

  @Put('markets/:asset/:fiat')
  async setMarketStatus(
    @CurrentOperator() operator: Operator,
    @Param('asset') asset: string,
    @Param('fiat') fiat: string,
    @Body() body: unknown,
  ) {
    assertRole(operator, 'admin');
    const { status, reason } = parse(marketStatusBody, body);
    await setMarketStatus(this.db, asset, fiat, status, reason, operator.id);
    return listMarkets(this.db);
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

  @Get('settings/fee-rates')
  async feeRates() {
    return feeRateOverview(this.db);
  }

  /** Changes the default rate or one market's rate, now or from a later time (FEE-4). */
  @Post('settings/fee-rates')
  async setFeeRate(@CurrentOperator() operator: Operator, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    assertStepUp(operator);
    const input = parse(feeRateBody, body);
    const change = await setFeeRate(
      this.db,
      { ...input, effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : undefined },
      operator.id,
    );
    return { change };
  }

  @Get('settings/billing')
  async billingSettings() {
    return { billing: await billingSettings(this.db) };
  }

  @Put('settings/billing')
  async setBillingSettings(@CurrentOperator() operator: Operator, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    assertStepUp(operator);
    const { cycle, dueDays, reason } = parse(billingBody, body);
    await updateSettings(this.db, { 'billing.cycle': cycle, 'billing.due_days': dueDays }, operator.id, reason);
    return { billing: await billingSettings(this.db) };
  }

  // Fees and billing --------------------------------------------------------------

  /** Fee totals for a range (this month in Korea time by default), unpaid makers, withdrawal fees. */
  @Get('fees/summary')
  async feeSummary(@Query() query: unknown) {
    const q = parse(summaryQuery, query);
    const { rows } = await this.db.query<{ start: Date; end: Date }>(
      `SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS start,
              (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') + interval '1 month') AT TIME ZONE 'Asia/Seoul' AS end`,
    );
    const from = q.from ? new Date(q.from) : rows[0]!.start;
    const to = q.to ? new Date(q.to) : rows[0]!.end;
    const withdrawalFees = await this.db.query<{ asset: string; balance: string }>(
      `SELECT asset, balance::text FROM ledger_accounts WHERE kind = 'fee_revenue' ORDER BY asset`,
    );
    return {
      from,
      to,
      ...(await this.billing.summary(from, to)),
      feeRevenueByAsset: withdrawalFees.rows.map((r) => ({ asset: r.asset, amount: r.balance })),
    };
  }

  @Get('fee-invoices')
  async feeInvoices(@Query() query: unknown) {
    const q = parse(invoiceQuery, query);
    return { ...(await this.billing.list(q)), page: q.page, pageSize: 20 };
  }

  @Get('fee-invoices/:id')
  async feeInvoice(@Param('id', uuid) id: string) {
    const detail = await this.billing.get(id);
    if (!detail) throw new DomainError('not_found', 'Invoice not found');
    return detail;
  }

  /** Records a payment confirmed outside the system (FEE-7). */
  @Post('fee-invoices/:id/payments')
  async recordFeePayment(@CurrentOperator() operator: Operator, @Param('id', uuid) id: string, @Body() body: unknown) {
    assertRole(operator, 'reviewer');
    assertStepUp(operator);
    const { amountMinor, paidAt, memo } = parse(paymentBody, body);
    return this.billing.recordPayment(id, { amountMinor, paidAt: new Date(paidAt), memo }, operator.id);
  }

  /** Runs the billing pass now instead of waiting for the worker. */
  @Post('fees/run-billing')
  @HttpCode(200)
  async runBilling(@CurrentOperator() operator: Operator) {
    assertRole(operator, 'admin');
    return this.billing.run();
  }

  @Get('audit')
  async audit(@Query() query: unknown) {
    const entries = await this.ops.audit(parse(auditQuery, query));
    const operatorIds = entries.filter((e) => e.actorType === 'operator' && e.actorId).map((e) => e.actorId!);
    return { entries, operatorNames: await this.ops.operatorNames([...new Set(operatorIds)]) };
  }
}
