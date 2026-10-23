import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { BillingService } from '../fees/billing.service';
import { AuthGuard, CurrentUser } from './auth.guard';

/** A maker's own fee invoices (FEE-6). */
@Controller('fees')
@UseGuards(AuthGuard)
export class FeesController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get('invoices')
  async invoices(@CurrentUser() userId: string) {
    return this.billing.forMaker(userId);
  }
}
