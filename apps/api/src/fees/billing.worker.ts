import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../config';
import { CONFIG } from '../tokens';
import { BillingService } from './billing.service';

/**
 * Issues fee invoices when a billing period ends, sends due-date reminders and
 * marks unpaid invoices overdue. Safe to run on several instances: orders and
 * invoices are locked while they change.
 */
@Injectable()
export class BillingWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BillingWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.billingIntervalSeconds <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.config.billingIntervalSeconds * 1000);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { issued, reminded, overdue } = await this.billing.run();
      if (issued || reminded || overdue) {
        this.logger.log(`Fee billing: ${issued} issued, ${reminded} reminded, ${overdue} overdue`);
      }
    } catch (err) {
      this.logger.error(err);
    } finally {
      this.running = false;
    }
  }
}
