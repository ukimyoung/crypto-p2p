import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';
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
 * Orders under review (PRD section 7). Moving escrow needs two operators:
 * one proposes release or refund with a reason, a different one approves it.
 */
export class DisputesService {
  constructor(
    private readonly db: Db,
    private readonly orders: OrdersService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Open disputes, oldest first, with any pending proposal. */
  async listOpen(): Promise<{ order: Order; proposal: DisputeResolution | null }[]> {
    const { rows } = await this.db.query(
      `SELECT id FROM orders WHERE status = 'under_review' ORDER BY paid_at NULLS LAST, created_at LIMIT 200`,
    );
    const ids = rows.map((r) => r.id as string);
    const proposals = await this.db.query(
      `SELECT * FROM dispute_resolutions WHERE order_id = ANY($1::uuid[]) AND status = 'proposed'`,
      [ids],
    );
    const byOrder = new Map(proposals.rows.map((r) => [r.order_id as string, toResolution(r)]));
    const out = [];
    for (const id of ids) {
      const order = await this.orders.get(id);
      if (order) out.push({ order, proposal: byOrder.get(id) ?? null });
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

  async propose(orderId: string, operatorId: string, decision: 'release' | 'refund', reason: string) {
    const text = reason.trim();
    if (text.length < 1 || text.length > 1000) {
      throw new DomainError('invalid_request', 'Give a reason (1-1000 characters)');
    }
    return withTransaction(this.db, async (tx) => {
      const { rows: orders } = await tx.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!orders[0]) throw new DomainError('not_found', 'Order not found');
      if (orders[0].status !== 'under_review') {
        throw new DomainError('invalid_transition', 'Only orders under review can be resolved');
      }
      const { rows } = await tx.query(
        `INSERT INTO dispute_resolutions (order_id, decision, reason, proposed_by, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (order_id) WHERE status = 'proposed' DO NOTHING
         RETURNING *`,
        [orderId, decision, text, operatorId, this.now()],
      );
      if (!rows[0]) throw new DomainError('proposal_pending', 'Another proposal is waiting for a decision');
      const proposal = toResolution(rows[0]);
      const target = { type: 'order', id: orderId };
      await writeAudit(tx, { type: 'operator', id: operatorId }, 'dispute.propose', target, null, proposal);
      return proposal;
    });
  }

  /** A second operator approves; escrow moves in the same transaction. */
  approve(resolutionId: string, operatorId: string): Promise<{ resolution: DisputeResolution; order: Order }> {
    return withTransaction(this.db, async (tx) => {
      const pending = await this.lockPending(tx, resolutionId);
      if (pending.proposedBy === operatorId) {
        throw new DomainError('two_person_rule', 'A different operator must approve this proposal');
      }
      const order = await this.orders.resolve(tx, pending.orderId, pending.decision, {
        requestedBy: pending.proposedBy,
        approvedBy: operatorId,
      });
      const resolution = await this.decide(tx, resolutionId, operatorId, 'approved');
      return { resolution, order };
    });
  }

  /** Any operator, including the proposer, can decline so a new proposal can be made. */
  decline(resolutionId: string, operatorId: string): Promise<DisputeResolution> {
    return withTransaction(this.db, async (tx) => {
      await this.lockPending(tx, resolutionId);
      return this.decide(tx, resolutionId, operatorId, 'declined');
    });
  }

  private async lockPending(tx: Tx, resolutionId: string): Promise<DisputeResolution> {
    const { rows } = await tx.query('SELECT * FROM dispute_resolutions WHERE id = $1 FOR UPDATE', [resolutionId]);
    if (!rows[0]) throw new DomainError('not_found', 'Proposal not found');
    const r = toResolution(rows[0]);
    if (r.status !== 'proposed') throw new DomainError('invalid_transition', `This proposal is already ${r.status}`);
    return r;
  }

  private async decide(tx: Tx, resolutionId: string, operatorId: string, status: 'approved' | 'declined') {
    const { rows } = await tx.query(
      `UPDATE dispute_resolutions SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1 RETURNING *`,
      [resolutionId, status, operatorId, this.now()],
    );
    const r = toResolution(rows[0]);
    const action = status === 'approved' ? 'dispute.approve' : 'dispute.decline';
    await writeAudit(tx, { type: 'operator', id: operatorId }, action, { type: 'order', id: r.orderId }, null, r);
    return r;
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
