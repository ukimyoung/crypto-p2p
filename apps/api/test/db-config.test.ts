import { describe, expect, it } from 'vitest';
import { poolConfig } from '../src/db/database';

const URL_ = 'postgresql://postgres.abc:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';

describe('database connection settings', () => {
  it('connects as given by default', () => {
    expect(poolConfig(URL_, {})).toEqual({ connectionString: URL_, max: 20 });
  });

  it('encrypts and drops a conflicting sslmode for hosted Postgres', () => {
    const config = poolConfig(`${URL_}?sslmode=require`, { DATABASE_SSL: 'require', DATABASE_POOL_MAX: '5' });
    expect(config).toEqual({ connectionString: URL_, max: 5, ssl: { rejectUnauthorized: false } });
  });
});
