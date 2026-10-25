import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/db/database';
import { ReceivingAddressesService } from '../src/payments/receiving-addresses.service';
import { createUser, setupDb } from './helpers';

const BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const EVM_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

describe('receiving addresses', () => {
  let db: Db;
  let service: ReceivingAddressesService;

  beforeAll(async () => {
    db = await setupDb();
    service = new ReceivingAddressesService(db);
  });
  afterAll(async () => {
    await db.end();
  });

  it('keeps one address per coin on the chosen network', async () => {
    const user = await createUser(db);
    await service.set(user, { asset: 'BTC', network: 'bitcoin', address: BTC_ADDRESS });
    await service.set(user, { asset: 'USDT', network: 'tron', address: TRON_ADDRESS });
    const eth = await service.set(user, { asset: 'ETH', network: 'ethereum', address: EVM_ADDRESS });
    expect(eth.address).toBe(EVM_ADDRESS.toLowerCase());

    const changed = await service.set(user, { asset: 'USDT', network: 'ethereum', address: EVM_ADDRESS });
    expect(changed).toMatchObject({ network: 'ethereum', status: 'active' });

    const list = await service.list(user);
    expect(list.map((a) => [a.asset, a.network])).toEqual([
      ['BTC', 'bitcoin'],
      ['ETH', 'ethereum'],
      ['USDT', 'ethereum'],
    ]);
    const history = await service.history(user);
    expect(history.filter((a) => a.asset === 'USDT').map((a) => [a.network, a.status])).toEqual([
      ['ethereum', 'active'],
      ['tron', 'removed'],
    ]);

    const audit = await db.query(
      `SELECT action FROM audit_logs WHERE actor_id = $1 AND target_type = 'receiving_address' ORDER BY id`,
      [user],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'receiving_address.add',
      'receiving_address.add',
      'receiving_address.add',
      'receiving_address.change',
    ]);
  });

  it('rejects networks the coin is not received on and addresses of another network', async () => {
    const user = await createUser(db);
    for (const input of [
      { asset: 'BTC', network: 'ethereum', address: EVM_ADDRESS },
      { asset: 'ETH', network: 'tron', address: TRON_ADDRESS },
      { asset: 'DOGE', network: 'bitcoin', address: BTC_ADDRESS },
    ]) {
      await expect(service.set(user, input)).rejects.toMatchObject({ code: 'invalid_network' });
    }
    await expect(service.set(user, { asset: 'USDT', network: 'tron', address: EVM_ADDRESS })).rejects.toMatchObject({
      code: 'invalid_address',
    });
    await expect(service.set(user, { asset: 'BTC', network: 'bitcoin', address: TRON_ADDRESS })).rejects.toMatchObject({
      code: 'invalid_address',
    });
    expect(await service.list(user)).toEqual([]);
  });

  it('removes an address', async () => {
    const user = await createUser(db);
    await service.set(user, { asset: 'BTC', network: 'bitcoin', address: BTC_ADDRESS });
    await service.remove(user, 'BTC');
    expect(await service.list(user)).toEqual([]);
    await expect(service.remove(user, 'BTC')).rejects.toMatchObject({ code: 'not_found' });
  });
});
