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
import { LedgerService } from './ledger/ledger.service';
import { OrdersService } from './orders/orders.service';
import { CONFIG, DB } from './tokens';

@Module({
  controllers: [HealthController, AuthController, AdsController, OrdersController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: DB, inject: [CONFIG], useFactory: (config: AppConfig) => createPool(config.databaseUrl) },
    {
      provide: AuthService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: AppConfig) =>
        new AuthService(db, new SecretBox(config.otpEncryptionKey), {
          sessionTtlHours: config.sessionTtlHours,
          maxFailedLogins: 5,
          lockoutMinutes: 15,
        }),
    },
    AuthGuard,
    { provide: LedgerService, useFactory: () => new LedgerService() },
    { provide: AdsService, inject: [DB], useFactory: (db: Db) => new AdsService(db) },
    {
      provide: OrdersService,
      inject: [DB, LedgerService, CONFIG],
      useFactory: (db: Db, ledger: LedgerService, config: AppConfig) =>
        new OrdersService(db, ledger, { makerFeeBps: config.makerFeeBps }),
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.end();
  }
}
