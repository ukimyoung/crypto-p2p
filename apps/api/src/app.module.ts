import { Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
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
import { KycController } from './http/kyc.controller';
import { OrdersController } from './http/orders.controller';
import { PaymentMethodsController } from './http/payment-methods.controller';
import { ReceivingAddressesController } from './http/receiving-addresses.controller';
import { NotificationsController } from './http/notifications.controller';
import { OpsAuthController, OpsController } from './http/ops.controller';
import { OpsGuard } from './http/ops.guard';
import { WalletController } from './http/wallet.controller';
import { KycService } from './kyc/kyc.service';
import { loadSumsubConfig, SumsubClient } from './kyc/sumsub.client';
import { LedgerService } from './ledger/ledger.service';
import { EmailWorker, LogEmailSender } from './notifications/email.worker';
import { NotificationsService } from './notifications/notifications.service';
import { loadResendConfig, ResendEmailSender } from './notifications/resend.client';
import { DisputesService } from './ops/disputes.service';
import { OperatorAuthService } from './ops/operator-auth.service';
import { OpsService } from './ops/ops.service';
import { OpsTradesService } from './ops/ops-trades.service';
import { OrderExpiryWorker } from './orders/expiry.worker';
import { OrderChatService } from './orders/order-chat.service';
import { OrdersService } from './orders/orders.service';
import { PaymentMethodsService } from './payments/payment-methods.service';
import { ReceivingAddressesService } from './payments/receiving-addresses.service';
import { CONFIG, DB, EMAIL_SENDER } from './tokens';
import { WalletService } from './wallet/wallet.service';

@Module({
  controllers: [HealthController, AuthController, AdsController, OrdersController, PaymentMethodsController, ReceivingAddressesController, WalletController, OpsAuthController, OpsController, NotificationsController, FeesController, KycController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: DB, inject: [CONFIG], useFactory: (config: AppConfig) => createPool(config.databaseUrl) },
    { provide: SecretBox, inject: [CONFIG], useFactory: (config: AppConfig) => new SecretBox(config.otpEncryptionKey) },
    {
      provide: AuthService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: AppConfig) =>
        new AuthService(db, {
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
    { provide: ReceivingAddressesService, inject: [DB], useFactory: (db: Db) => new ReceivingAddressesService(db) },
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
    {
      // Without a Resend API key in the environment, emails are written to the log instead of sent.
      provide: EMAIL_SENDER,
      useFactory: () => {
        const resend = loadResendConfig();
        const logger = new Logger('Email');
        if (!resend) {
          logger.warn('RESEND_API_KEY is not set: emails are written to this log instead of sent');
          return new LogEmailSender();
        }
        logger.log(`Sending email through Resend as ${resend.from}`);
        return new ResendEmailSender(resend);
      },
    },
    EmailWorker,
    { provide: OpsService, inject: [DB], useFactory: (db: Db) => new OpsService(db) },
    { provide: BillingService, inject: [DB], useFactory: (db: Db) => new BillingService(db) },
    { provide: OpsTradesService, inject: [DB], useFactory: (db: Db) => new OpsTradesService(db) },
    BillingWorker,
    {
      // Without the Sumsub keys in the environment, identity verification reports itself as not set up.
      provide: KycService,
      inject: [DB],
      useFactory: (db: Db) => {
        const sumsub = loadSumsubConfig();
        const logger = new Logger('KYC');
        if (sumsub) logger.log(`Identity verification through Sumsub, level ${sumsub.levelName}`);
        else logger.warn('Sumsub keys are not set: identity verification is turned off');
        return new KycService(db, sumsub ? new SumsubClient(sumsub) : null);
      },
    },
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
