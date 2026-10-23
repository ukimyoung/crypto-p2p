import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { AdsService } from './ads/ads.service';
import { AuthService } from './auth/auth.service';
import { SecretBox } from './auth/secret-box';
import { AppConfig, loadConfig } from './config';
import { createPool, Db } from './db/database';
import { BillingService } from './fees/billing.service';
import { BillingWorker } from './fees/billing.worker';
import { HealthController } from './health/health.controller';
import { AdsController } from './http/ads.controller';
import { AuthController } from './http/auth.controller';
import { AuthGuard } from './http/auth.guard';
import { FeesController } from './http/fees.controller';
import { OrdersController } from './http/orders.controller';
import { PaymentMethodsController } from './http/payment-methods.controller';
import { NotificationsController } from './http/notifications.controller';
import { OpsAuthController, OpsController } from './http/ops.controller';
import { OpsGuard } from './http/ops.guard';
import { WalletController } from './http/wallet.controller';
import { LedgerService } from './ledger/ledger.service';
import { EmailWorker, LogEmailSender } from './notifications/email.worker';
import { NotificationsService } from './notifications/notifications.service';
import { DisputesService } from './ops/disputes.service';
import { OperatorAuthService } from './ops/operator-auth.service';
import { OpsService } from './ops/ops.service';
import { OpsTradesService } from './ops/ops-trades.service';
import { OrderExpiryWorker } from './orders/expiry.worker';
import { OrderChatService } from './orders/order-chat.service';
import { OrdersService } from './orders/orders.service';
import { PaymentMethodsService } from './payments/payment-methods.service';
import { CONFIG, DB, EMAIL_SENDER } from './tokens';
import { WalletService } from './wallet/wallet.service';

@Module({
  controllers: [HealthController, AuthController, AdsController, OrdersController, PaymentMethodsController, WalletController, OpsAuthController, OpsController, NotificationsController, FeesController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: DB, inject: [CONFIG], useFactory: (config: AppConfig) => createPool(config.databaseUrl) },
    { provide: SecretBox, inject: [CONFIG], useFactory: (config: AppConfig) => new SecretBox(config.otpEncryptionKey) },
    {
      provide: AuthService,
      inject: [DB, SecretBox, CONFIG],
      useFactory: (db: Db, secrets: SecretBox, config: AppConfig) =>
        new AuthService(db, secrets, {
          sessionTtlHours: config.sessionTtlHours,
          maxFailedLogins: 5,
          lockoutMinutes: 15,
        }),
    },
    AuthGuard,
    { provide: LedgerService, useFactory: () => new LedgerService() },
    {
      provide: PaymentMethodsService,
      inject: [DB, SecretBox, CONFIG],
      useFactory: (db: Db, secrets: SecretBox, config: AppConfig) =>
        new PaymentMethodsService(db, secrets, { cooldownHours: config.paymentMethodCooldownHours }),
    },
    {
      provide: AdsService,
      inject: [DB, PaymentMethodsService],
      useFactory: (db: Db, payments: PaymentMethodsService) => new AdsService(db, payments),
    },
    {
      provide: OrdersService,
      inject: [DB, LedgerService, PaymentMethodsService],
      useFactory: (db: Db, ledger: LedgerService, payments: PaymentMethodsService) =>
        new OrdersService(db, ledger, payments),
    },
    { provide: OrderChatService, inject: [DB], useFactory: (db: Db) => new OrderChatService(db) },
    OrderExpiryWorker,
    {
      provide: WalletService,
      inject: [DB, LedgerService, CONFIG],
      useFactory: (db: Db, ledger: LedgerService, config: AppConfig) =>
        new WalletService(db, ledger, { addressCooldownHours: config.addressCooldownHours }),
    },
    {
      provide: OperatorAuthService,
      inject: [DB, SecretBox, CONFIG],
      useFactory: (db: Db, secrets: SecretBox, config: AppConfig) =>
        new OperatorAuthService(db, secrets, {
          sessionTtlHours: config.opsSessionTtlHours,
          maxFailedLogins: 5,
          lockoutMinutes: 15,
        }),
    },
    OpsGuard,
    { provide: NotificationsService, inject: [DB], useFactory: (db: Db) => new NotificationsService(db) },
    // Swap for a real provider (SES, SendGrid, ...) once one is chosen.
    { provide: EMAIL_SENDER, useFactory: () => new LogEmailSender() },
    EmailWorker,
    { provide: OpsService, inject: [DB], useFactory: (db: Db) => new OpsService(db) },
    { provide: BillingService, inject: [DB], useFactory: (db: Db) => new BillingService(db) },
    { provide: OpsTradesService, inject: [DB], useFactory: (db: Db) => new OpsTradesService(db) },
    BillingWorker,
    {
      provide: DisputesService,
      inject: [DB, OrdersService],
      useFactory: (db: Db, orders: OrdersService) => new DisputesService(db, orders),
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.end();
  }
}
