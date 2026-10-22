import { Db } from '../db/database';

export interface Notification {
  id: string;
  type: string;
  data: Record<string, string | null>;
  createdAt: Date;
  readAt: Date | null;
}

/** A user's in-app notifications. */
export class NotificationsService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(userId: string, limit = 50): Promise<{ notifications: Notification[]; unread: number }> {
    const { rows } = await this.db.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT $2',
      [userId, Math.min(limit, 100)],
    );
    return {
      notifications: rows.map((r) => ({
        id: String(r.id),
        type: r.type,
        data: r.data,
        createdAt: r.created_at,
        readAt: r.read_at,
      })),
      unread: await this.unreadCount(userId),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return rows[0]!.n;
  }

  /** Marks everything up to and including `upToId` as read. */
  async markRead(userId: string, upToId: string): Promise<void> {
    await this.db.query(
      'UPDATE notifications SET read_at = $3 WHERE user_id = $1 AND id <= $2 AND read_at IS NULL',
      [userId, upToId, this.now()],
    );
  }
}
