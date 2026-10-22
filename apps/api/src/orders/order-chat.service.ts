import { DomainError } from '../common/errors';
import { Db } from '../db/database';

export interface OrderMessage {
  id: string;
  senderId: string;
  body: string;
  createdAt: Date;
}

/** Text chat between the two parties of an order. Kept as dispute evidence. */
export class OrderChatService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async post(orderId: string, senderId: string, body: string): Promise<OrderMessage> {
    const text = body.trim();
    if (text.length < 1 || text.length > 1000) {
      throw new DomainError('invalid_message', 'Messages must be 1-1000 characters');
    }
    await this.assertParty(orderId, senderId);
    const { rows } = await this.db.query(
      `INSERT INTO order_messages (order_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING *`,
      [orderId, senderId, text, this.now()],
    );
    return toMessage(rows[0]);
  }

  /** Messages after `afterId`, oldest first, so clients can poll for new ones. */
  async list(orderId: string, viewerId: string, afterId = '0'): Promise<OrderMessage[]> {
    await this.assertParty(orderId, viewerId);
    const { rows } = await this.db.query(
      'SELECT * FROM order_messages WHERE order_id = $1 AND id > $2 ORDER BY id LIMIT 200',
      [orderId, afterId],
    );
    return rows.map(toMessage);
  }

  private async assertParty(orderId: string, userId: string): Promise<void> {
    const { rows } = await this.db.query<{ buyer_id: string; seller_id: string }>(
      'SELECT buyer_id, seller_id FROM orders WHERE id = $1',
      [orderId],
    );
    const order = rows[0];
    if (!order || (order.buyer_id !== userId && order.seller_id !== userId)) {
      throw new DomainError('not_found', 'Order not found');
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMessage(row: any): OrderMessage {
  return { id: String(row.id), senderId: row.sender_id, body: row.body, createdAt: row.created_at };
}
