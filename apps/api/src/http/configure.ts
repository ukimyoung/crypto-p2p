import { INestApplication } from '@nestjs/common';
import { DomainErrorFilter } from './domain-error.filter';

/** Shared app setup for the server and the HTTP tests. */
export function configureApp(app: INestApplication): void {
  const express = app.getHttpAdapter().getInstance();
  // Amounts are bigint; send them as decimal strings.
  express.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  express.set('trust proxy', 1);
  app.useGlobalFilters(new DomainErrorFilter());
  app.enableShutdownHooks();
}
