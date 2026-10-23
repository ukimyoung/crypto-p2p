import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, withTransaction } from '../db/database';
import { OrderMessage } from '../orders/order-chat.service';
import { Order, OrdersService } from '../orders/orders.service';

export interface DisputeResolution {
  id: string;
  orderId: string;
  decision: 'release' | 'refund';
  reason: string;
  status: 'proposed' | 'approved' | 'declined';
  proposedBy: string;
  decidedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface DisputeCase {
  order: Order;
  messages: OrderMessage[];
  resolutions: DisputeResolution[];
}

/**
 * Orders under review (PRD section 7). One reviewer decides release or refund
 * with a reason; escrow moves in the same transaction as the decision record.
 */
export class DisputesService {
  constructor(
    private readonly db: Db,
    private readonly orders: OrdersService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Open disputes, oldest first. */
  async listOpen(): Promise<{ order: Order }[]> {
    const { rows } = await this.db.query(
      `SELECT id FROM orders WHERE status = 'under_review' ORDER BY paid_at NULLS LAST, created_at LIMIT 200`,
    );
    const out = [];
    for (const { id } of rows) {
      const order = await this.orders.get(id);
      if (order) out.push({ order });
    }
    return out;
  }

  async getCase(orderId: string): Promise<DisputeCase> {
    const order = await this.orders.get(orderId);
    if (!order) throw new DomainError('not_found', 'Order not found');
    const messages = await this.db.query(
      'SELECT * FROM order_messages WHERE order_id = $1 ORDER BY id LIMIT 1000',
      [orderId],
    );
    const resolutions = await this.db.query(
      'SELECT * FROM dispute_resolutions WHERE order_id = $1 ORDER BY created_at',
      [orderId],
    );
    return {
      order,
      messages: messages.rows.map((m) => ({
        id: String(m.id),
        senderId: m.sender_id,
        body: m.body,
        createdAt: m.created_at,
      })),
      resolutions: resolutions.rows.map(toResolution),
    };
  }

  /** Decides the dispute and moves escrow to the buyer (`release`) or back to the seller (`refund`). */
  async resolve(
    orderId: string,
    operatorId: string,
    decision: 'release' | 'refund',
    reason: string,
  ): Promise<{ resolution: DisputeResolution; order: Order }> {
    const text = reason.trim();
    if (text.length < 1 || text.length > 1000) {
      throw new DomainError('invalid_request', 'Give a reason (1-1000 characters)');
    }
    return withTransaction(this.db, async (tx) => {
      // Locks the order and checks it is still under review before anything is written.
      const order = await this.orders.resolve(tx, orderId, decision, operatorId);
      const now = this.now();
      const { rows } = await tx.query(
        `INSERT INTO dispute_resolutions (order_id, decision, reason, status, proposed_by, decided_by, created_at, decided_at)
         VALUES ($1, $2, $3, 'approved', $4, $4, $5, $5)
         RETURNING *`,
        [orderId, decision, text, operatorId, now],
      );
      const resolution = toResolution(rows[0]);
      await writeAudit(tx, { type: 'operator', id: operatorId }, 'dispute.resolve', { type: 'order', id: orderId }, null, resolution);
      return { resolution, order };
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResolution(row: any): DisputeResolution {
  return {
    id: row.id,
    orderId: row.order_id,
    decision: row.decision,
    reason: row.reason,
    status: row.status,
    proposedBy: row.proposed_by,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}
