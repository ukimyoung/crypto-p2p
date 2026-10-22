import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/db/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { normalizeAddress } from '../src/wallet/address';
import { DEFAULT_WALLET_CONFIG } from '../src/wallet/wallet-config';
import { WalletService } from '../src/wallet/wallet.service';
import { nextWithdrawalStatus } from '../src/wallet/withdrawal-state';
import { BTC, createUser, deposit, setupDb } from './helpers';

const BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LEGACY = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const ETH_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const FEE = DEFAULT_WALLET_CONFIG.assets.BTC!.fee;
const OPERATOR = '00000000-0000-4000-8000-0000000000aa';

describe('address format', () => {
  it('accepts bitcoin and ethereum addresses in canonical form', () => {
    expect(normalizeAddress('bitcoin', BECH32)).toBe(BECH32);
    expect(normalizeAddress('bitcoin', ` ${BECH32.toUpperCase()} `)).toBe(BECH32);
    expect(normalizeAddress('bitcoin', LEGACY)).toBe(LEGACY);
    expect(normalizeAddress('ethereum', ETH_ADDRESS)).toBe(ETH_ADDRESS.toLowerCase());
  });

  it('rejects typos, mixed-case bech32 and wrong-network addresses', () => {
    for (const [network, address] of [
      ['bitcoin', ETH_ADDRESS],
      ['bitcoin', 'bc1qAr0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
      ['bitcoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN0'], // 0 is not base58
      ['ethereum', BECH32],
      ['ethereum', '0x1234'],
    ] as const) {
      expect(() => normalizeAddress(network, address)).toThrow(expect.objectContaining({ code: 'invalid_address' }));
    }
  });
});

describe('withdrawal state machine', () => {
  it('lets each role do only its own steps', () => {
    expect(nextWithdrawalStatus('requested', 'cancel', 'user')).toBe('cancelled');
    expect(nextWithdrawalStatus('requested', 'approve', 'operator')).toBe('approved');
    expect(nextWithdrawalStatus('approved', 'broadcast', 'system')).toBe('sent');
    expect(nextWithdrawalStatus('sent', 'confirm', 'system')).toBe('confirmed');
    expect(nextWithdrawalStatus('sent', 'fail', 'system')).toBe('failed');
    expect(() => nextWithdrawalStatus('requested', 'approve', 'user')).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    );
    expect(() => nextWithdrawalStatus('approved', 'cancel', 'user')).toThrow(
      expect.objectContaining({ code: 'invalid_transition' }),
    );
    expect(() => nextWithdrawalStatus('confirmed', 'fail', 'system')).toThrow(
      expect.objectContaining({ code: 'invalid_transition' }),
    );
  });
});

describe('wallet', () => {
  let db: Db;
  let clock: Date;
  let wallet: WalletService;
  const ledger = new LedgerService();
  const hours = (n: number) => {
    clock = new Date(clock.getTime() + n * 3_600_000);
  };
  const available = (userId: string) => ledger.balance(db, { userId, asset: 'BTC', kind: 'available' });
  const pending = (userId: string) => ledger.balance(db, { userId, asset: 'BTC', kind: 'withdrawal_pending' });

  /** A KYC level 1 user holding `funds` BTC with a whitelisted address past its cooldown. */
  async function funded(funds = BTC) {
    const userId = await createUser(db);
    await deposit(db, ledger, userId, 'BTC', funds);
    const address = await wallet.addAddress(userId, { asset: 'BTC', address: BECH32 });
    hours(24);
    return { userId, addressId: address.id };
  }

  beforeAll(async () => {
    db = await setupDb();
    wallet = new WalletService(db, ledger, DEFAULT_WALLET_CONFIG, () => clock);
  });
  beforeEach(() => {
    clock = new Date('2026-10-22T00:00:00Z');
  });
  afterAll(async () => {
    await db.end();
  });

  it('reports balances for every asset', async () => {
    const userId = await createUser(db);
    await deposit(db, ledger, userId, 'BTC', 5n);
    expect(await wallet.balances(userId)).toEqual([
      { asset: 'BTC', available: 5n, escrow: 0n, withdrawalPending: 0n },
      { asset: 'ETH', available: 0n, escrow: 0n, withdrawalPending: 0n },
      { asset: 'USDT', available: 0n, escrow: 0n, withdrawalPending: 0n },
    ]);
  });

  describe('address whitelist', () => {
    it('refuses duplicates and allows re-adding after removal', async () => {
      const userId = await createUser(db);
      const first = await wallet.addAddress(userId, { asset: 'BTC', address: BECH32, label: ' cold ' });
      expect(first).toMatchObject({ address: BECH32, label: 'cold' });
      expect(first.usableFrom).toEqual(new Date('2026-10-23T00:00:00Z'));
      await expect(wallet.addAddress(userId, { asset: 'BTC', address: BECH32.toUpperCase() })).rejects.toMatchObject({
        code: 'address_exists',
      });
      // A bitcoin address is no good for an ethereum asset.
      await expect(wallet.addAddress(userId, { asset: 'ETH', address: BECH32 })).rejects.toMatchObject({
        code: 'invalid_address',
      });

      await wallet.removeAddress(userId, first.id);
      expect(await wallet.listAddresses(userId)).toEqual([]);
      await wallet.addAddress(userId, { asset: 'BTC', address: BECH32 });
      await expect(wallet.removeAddress(await createUser(db), first.id)).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('withdrawals', () => {
    it('auto-approves small withdrawals and locks amount plus fee', async () => {
      const { userId, addressId } = await funded();
      const w = await wallet.requestWithdrawal(userId, addressId, BTC / 100n);
      expect(w).toMatchObject({ status: 'approved', amount: BTC / 100n, fee: FEE, address: BECH32 });
      expect(await available(userId)).toBe(BTC - BTC / 100n - FEE);
      expect(await pending(userId)).toBe(BTC / 100n + FEE);

      await wallet.markSent(w.id, '0xabc');
      const done = await wallet.markConfirmed(w.id);
      expect(done).toMatchObject({ status: 'confirmed', txHash: '0xabc' });
      expect(await pending(userId)).toBe(0n);
      expect(await ledger.balance(db, { system: 'fee_revenue', asset: 'BTC' })).toBeGreaterThanOrEqual(FEE);
      expect(await ledger.findMismatchedAccounts(db)).toEqual([]);
    });

    it('sends large withdrawals to operator review', async () => {
      const { userId, addressId } = await funded();
      const big = await wallet.requestWithdrawal(userId, addressId, BTC / 2n);
      expect(big.status).toBe('requested');

      const rejected = await wallet.reject(big.id, OPERATOR, 'Source of funds unclear');
      expect(rejected).toMatchObject({ status: 'rejected', reviewNote: 'Source of funds unclear' });
      expect(await available(userId)).toBe(BTC);
      expect(await pending(userId)).toBe(0n);

      const again = await wallet.requestWithdrawal(userId, addressId, BTC / 2n);
      expect((await wallet.approve(again.id, OPERATOR)).status).toBe('approved');
    });

    it('lets the user cancel only their own request before review', async () => {
      const { userId, addressId } = await funded();
      const big = await wallet.requestWithdrawal(userId, addressId, BTC / 2n);
      await expect(wallet.cancel(big.id, await createUser(db))).rejects.toMatchObject({ code: 'not_found' });
      expect((await wallet.cancel(big.id, userId)).status).toBe('cancelled');
      expect(await available(userId)).toBe(BTC);

      const small = await wallet.requestWithdrawal(userId, addressId, BTC / 100n);
      await expect(wallet.cancel(small.id, userId)).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('returns funds when custody fails to send', async () => {
      const { userId, addressId } = await funded();
      const w = await wallet.requestWithdrawal(userId, addressId, BTC / 100n);
      expect((await wallet.markFailed(w.id, 'node unavailable')).status).toBe('failed');
      expect(await available(userId)).toBe(BTC);
      await expect(wallet.markConfirmed(w.id)).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('checks address ownership, cooldown, minimum and balance', async () => {
      const { userId, addressId } = await funded(BTC / 100n);
      const stranger = await createUser(db);
      await expect(wallet.requestWithdrawal(stranger, addressId, BTC / 100n)).rejects.toMatchObject({
        code: 'address_invalid',
      });

      const fresh = await wallet.addAddress(userId, { asset: 'BTC', address: LEGACY });
      await expect(wallet.requestWithdrawal(userId, fresh.id, BTC / 1000n)).rejects.toMatchObject({
        code: 'address_cooldown',
      });

      await expect(wallet.requestWithdrawal(userId, addressId, 1000n)).rejects.toMatchObject({ code: 'below_minimum' });
      // The fee comes on top, so the whole balance cannot be withdrawn.
      await expect(wallet.requestWithdrawal(userId, addressId, BTC / 100n)).rejects.toMatchObject({
        code: 'insufficient_balance',
      });
      const { rows } = await db.query('SELECT count(*)::int AS n FROM withdrawals WHERE user_id = $1', [userId]);
      expect(rows[0].n).toBe(0);
    });

    it('requires KYC and an account that is not on hold', async () => {
      const { userId, addressId } = await funded();
      await db.query('UPDATE users SET kyc_level = 0 WHERE id = $1', [userId]);
      await expect(wallet.requestWithdrawal(userId, addressId, BTC / 100n)).rejects.toMatchObject({
        code: 'kyc_required',
      });
      await db.query("UPDATE users SET kyc_level = 1, status = 'withdraw_held' WHERE id = $1", [userId]);
      await expect(wallet.requestWithdrawal(userId, addressId, BTC / 100n)).rejects.toMatchObject({
        code: 'user_restricted',
      });
    });

    it('enforces a rolling 24-hour limit that ignores cancelled requests', async () => {
      const { userId, addressId } = await funded(5n * BTC);
      const first = await wallet.requestWithdrawal(userId, addressId, (BTC * 6n) / 10n);
      await expect(wallet.requestWithdrawal(userId, addressId, (BTC * 5n) / 10n)).rejects.toMatchObject({
        code: 'daily_limit_exceeded',
      });
      await wallet.cancel(first.id, userId);
      await wallet.requestWithdrawal(userId, addressId, (BTC * 5n) / 10n);

      const limits = await wallet.limits(userId);
      expect(limits.find((l) => l.asset === 'BTC')).toMatchObject({ dailyLimit: BTC, usedToday: BTC / 2n });

      hours(24);
      await wallet.requestWithdrawal(userId, addressId, (BTC * 9n) / 10n);
    });

    it('does not let concurrent requests slip past the limit', async () => {
      const { userId, addressId } = await funded(5n * BTC);
      const results = await Promise.allSettled([
        wallet.requestWithdrawal(userId, addressId, (BTC * 6n) / 10n),
        wallet.requestWithdrawal(userId, addressId, (BTC * 6n) / 10n),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: expect.objectContaining({ code: 'daily_limit_exceeded' }),
      });
    });
  });
});
