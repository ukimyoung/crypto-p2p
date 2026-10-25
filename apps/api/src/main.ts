import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { configureApp } from './http/configure';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  await app.listen(config.port);
}

void bootstrap();
