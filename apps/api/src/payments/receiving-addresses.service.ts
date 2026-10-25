import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { normalizeAddress } from '../wallet/address';

/**
 * Networks a member can receive each coin on, in the order the account page lists them.
 * The address format is checked for the chosen network, so an Ethereum address cannot be
 * saved as a Tron one.
 */
export const RECEIVING_NETWORKS: Record<string, readonly string[]> = {
  BTC: ['bitcoin'],
  ETH: ['ethereum', 'arbitrum', 'base'],
  USDT: ['ethereum', 'tron', 'bsc'],
};

export interface ReceivingAddress {
  id: string;
  asset: string;
  network: string;
  address: string;
  status: 'active' | 'removed';
  createdAt: Date;
  removedAt: Date | null;
}

/**
 * Crypto addresses members receive coins at, one per coin. Adding and changing one replaces the
 * active row and keeps the old one as `removed`, so operators can see what was registered before.
 */
export class ReceivingAddressesService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(userId: string): Promise<ReceivingAddress[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM receiving_addresses WHERE user_id = $1 AND status = 'active' ORDER BY asset`,
      [userId],
    );
    return rows.map(toAddress);
  }

  /** Active and removed addresses, newest first, for the member detail in the admin page. */
  async history(userId: string): Promise<ReceivingAddress[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM receiving_addresses WHERE user_id = $1 ORDER BY created_at DESC, id`,
      [userId],
    );
    return rows.map(toAddress);
  }

  /** Registers the coin's address, or replaces the one already registered. */
  async set(userId: string, input: { asset: string; network: string; address: string }): Promise<ReceivingAddress> {
    const networks = RECEIVING_NETWORKS[input.asset];
    if (!networks) throw new DomainError('invalid_network', `${input.asset} cannot be received`);
    if (!networks.includes(input.network)) {
      throw new DomainError('invalid_network', `${input.asset} cannot be received on ${input.network}`);
    }
    const address = normalizeAddress(input.network, input.address);

    return withTransaction(this.db, async (tx) => {
      // One change at a time per member, so two requests cannot both leave an active row.
      const owner = await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!owner.rowCount) throw new DomainError('not_found', 'User not found');
      const { rows: old } = await tx.query(
        `UPDATE receiving_addresses SET status = 'removed', removed_at = $3
         WHERE user_id = $1 AND asset = $2 AND status = 'active'
         RETURNING *`,
        [userId, input.asset, this.now()],
      );
      const { rows } = await tx.query(
        `INSERT INTO receiving_addresses (user_id, asset, network, address, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, input.asset, input.network, address, this.now()],
      );
      const added = toAddress(rows[0]);
      const before = old[0] ? toAddress(old[0]) : null;
      await writeAudit(
        tx,
        { type: 'user', id: userId },
        before ? 'receiving_address.change' : 'receiving_address.add',
        { type: 'receiving_address', id: added.id },
        before,
        added,
      );
      return added;
    });
  }

  async remove(userId: string, asset: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `UPDATE receiving_addresses SET status = 'removed', removed_at = $3
         WHERE user_id = $1 AND asset = $2 AND status = 'active'
         RETURNING *`,
        [userId, asset, this.now()],
      );
      if (!rows[0]) throw new DomainError('not_found', 'No address registered for this coin');
      const removed = toAddress(rows[0]);
      await writeAudit(
        tx,
        { type: 'user', id: userId },
        'receiving_address.remove',
        { type: 'receiving_address', id: removed.id },
        { ...removed, status: 'active', removedAt: null },
        removed,
      );
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAddress(row: any): ReceivingAddress {
  return {
    id: row.id,
    asset: row.asset,
    network: row.network,
    address: row.address,
    status: row.status,
    createdAt: row.created_at,
    removedAt: row.removed_at,
  };
}
