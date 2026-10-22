import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { AdsService } from './ads/ads.service';
import { AuthService } from './auth/auth.service';
import { SecretBox } from './auth/secret-box';
import { AppConfig, loadConfig } from './config';
import { createPool, Db } from './db/database';
import { HealthController } from './health/health.controller';
import { AdsController } from './http/ads.controller';
import { AuthController } from './http/auth.controller';
import { AuthGuard } from './http/auth.guard';
import { OrdersController } from './http/orders.controller';
import { PaymentMethodsController } from './http/payment-methods.controller';
import { WalletController } from './http/wallet.controller';
import { LedgerService } from './ledger/ledger.service';
import { OrderExpiryWorker } from './orders/expiry.worker';
import { OrderChatService } from './orders/order-chat.service';
import { OrdersService } from './orders/orders.service';
import { PaymentMethodsService } from './payments/payment-methods.service';
import { CONFIG, DB } from './tokens';
import { DEFAULT_WALLET_CONFIG } from './wallet/wallet-config';
import { WalletService } from './wallet/wallet.service';

@Module({
  controllers: [HealthController, AuthController, AdsController, OrdersController, PaymentMethodsController, WalletController],
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
      inject: [DB, LedgerService, PaymentMethodsService, CONFIG],
      useFactory: (db: Db, ledger: LedgerService, payments: PaymentMethodsService, config: AppConfig) =>
        new OrdersService(db, ledger, payments, { makerFeeBps: config.makerFeeBps }),
    },
    { provide: OrderChatService, inject: [DB], useFactory: (db: Db) => new OrderChatService(db) },
    OrderExpiryWorker,
    {
      provide: WalletService,
      inject: [DB, LedgerService, CONFIG],
      useFactory: (db: Db, ledger: LedgerService, config: AppConfig) =>
        new WalletService(db, ledger, { ...DEFAULT_WALLET_CONFIG, addressCooldownHours: config.addressCooldownHours }),
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.end();
  }
}
