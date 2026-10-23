import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../config';
import { CONFIG } from '../tokens';
import { OrdersService } from './orders.service';

/**
 * Cancels orders whose payment window ran out and returns the escrow to the
 * seller, and sends paid orders the seller has not released in time to operator
 * review. Safe to run on several instances: each order is locked while it changes.
 */
@Injectable()
export class OrderExpiryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OrderExpiryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.orderExpiryIntervalSeconds <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.config.orderExpiryIntervalSeconds * 1000);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.orders.expireDue();
      if (expired.length) this.logger.log(`Expired ${expired.length} unpaid order(s)`);
      const reviewed = await this.orders.autoReviewDue();
      if (reviewed.length) this.logger.log(`Sent ${reviewed.length} unreleased order(s) to review`);
    } catch (err) {
      this.logger.error(err);
    } finally {
      this.running = false;
    }
  }
}
