import { Controller, Get, Inject } from '@nestjs/common';
import { Db } from '../db/database';
import { DB } from '../tokens';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}
