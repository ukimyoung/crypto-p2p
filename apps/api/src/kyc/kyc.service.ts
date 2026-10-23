import { createHash } from 'node:crypto';
import { Actor, writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';
import { notify } from '../notifications/notify';
import { SumsubApi, SumsubApplicant } from './sumsub.client';

export interface KycApplicantView {
  applicantId: string;
  levelName: string | null;
  reviewStatus: string;
  reviewAnswer: 'GREEN' | 'RED' | null;
  rejectType: 'RETRY' | 'FINAL' | null;
  rejectLabels: string[];
  moderationComment: string | null;
  /** Sumsub's note for staff. Not shown to the member. */
  clientComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where operators open an applicant in the Sumsub console (KYC-4). */
export const sumsubConsoleUrl = (applicantId: string) =>
  `https://cockpit.sumsub.com/checkus#/applicant/${encodeURIComponent(applicantId)}/basicInfo`;

/**
 * Identity verification through Sumsub (KYC-1 to KYC-6). One Sumsub level: passing it sets
 * KYC level 1 and the legal name read from the ID. `sumsub` is null until the keys are set.
 */
export class KycService {
  constructor(
    private readonly db: Db,
    private readonly sumsub: SumsubApi | null,
  ) {}

  get configured(): boolean {
    return this.sumsub !== null;
  }

  /** The member's own view: their level and where the review stands. */
  async status(userId: string) {
    const { rows } = await this.db.query('SELECT kyc_level FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new DomainError('not_found', 'User not found');
    const applicant = await this.applicant(this.db, userId);
    return {
      kycLevel: rows[0].kyc_level as number,
      available: this.configured,
      applicant: applicant && {
        reviewStatus: applicant.reviewStatus,
        reviewAnswer: applicant.reviewAnswer,
        rejectType: applicant.rejectType,
        moderationComment: applicant.moderationComment,
        updatedAt: applicant.updatedAt,
      },
    };
  }

  /** A WebSDK token for the member (KYC-1). The applicant is keyed by our member id. */
  async accessToken(userId: string): Promise<{ token: string; levelName: string }> {
    const sumsub = this.require();
    const { rows } = await this.db.query('SELECT kyc_level, status FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new DomainError('not_found', 'User not found');
    if (rows[0].status === 'closed') throw new DomainError('account_closed', 'This account is closed');
    if (rows[0].kyc_level >= 1) throw new DomainError('invalid_transition', 'Identity verification is already done');
    const applicant = await this.applicant(this.db, userId);
    if (applicant?.reviewAnswer === 'RED' && applicant.rejectType === 'FINAL' && applicant.reviewStatus === 'completed') {
      throw new DomainError('kyc_rejected', 'Identity verification was rejected. Please contact support.');
    }
    return { token: await sumsub.accessToken(userId), levelName: sumsub.levelName };
  }

  /**
   * A Sumsub webhook (KYC-2). The signature is checked first; a body seen before is ignored.
   * Rather than trust the order deliveries arrive in, the applicant is read back from Sumsub
   * and its current state applied.
   */
  async handleWebhook(body: Buffer | undefined, digest: string | undefined, alg: string | undefined) {
    const sumsub = this.require();
    if (!body || !sumsub.verifyWebhook(body, digest, alg)) {
      throw new DomainError('invalid_signature', 'Webhook signature does not match');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw new DomainError('invalid_request', 'Webhook body is not JSON');
    }
    const hash = createHash('sha256').update(body).digest('hex');
    const seen = await this.db.query('SELECT 1 FROM sumsub_webhooks WHERE body_sha256 = $1', [hash]);
    if (seen.rows[0]) return { duplicate: true };

    const externalUserId = typeof payload.externalUserId === 'string' ? payload.externalUserId : null;
    const userId = externalUserId && UUID.test(externalUserId) ? externalUserId : null;
    const applicant = userId ? await sumsub.applicantByExternalId(userId) : null;

    return withTransaction(this.db, async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO sumsub_webhooks (body_sha256, type, applicant_id, external_user_id, payload)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (body_sha256) DO NOTHING RETURNING id`,
        [hash, String(payload.type ?? 'unknown'), payload.applicantId ?? null, externalUserId, payload],
      );
      if (!inserted.rows[0]) return { duplicate: true };
      if (!userId || !applicant) return { duplicate: false };
      const user = await tx.query('SELECT 1 FROM users WHERE id = $1', [userId]);
      if (!user.rows[0]) return { duplicate: false };
      await this.apply(tx, userId, applicant, { type: 'system' });
      return { duplicate: false };
    });
  }

  /** Reads the applicant from Sumsub and applies it, for a missed webhook (KYC-5). */
  async sync(userId: string, operatorId: string): Promise<KycApplicantView | null> {
    const sumsub = this.require();
    await this.assertUser(userId);
    const applicant = await sumsub.applicantByExternalId(userId);
    return withTransaction(this.db, async (tx) => {
      const actor: Actor = { type: 'operator', id: operatorId };
      if (applicant) await this.apply(tx, userId, applicant, actor);
      await writeAudit(tx, actor, 'user.kyc_sync', { type: 'user', id: userId }, null, {
        found: applicant !== null,
        reviewStatus: applicant?.reviewStatus ?? null,
        reviewAnswer: applicant?.reviewAnswer ?? null,
      });
      return this.applicant(tx, userId);
    });
  }

  /** Asks Sumsub to review the applicant again (KYC-5). */
  async requestCheck(userId: string, reason: string, operatorId: string): Promise<void> {
    const sumsub = this.require();
    const text = reason.trim();
    if (!text) throw new DomainError('invalid_request', 'Give a reason');
    const applicant = await this.applicant(this.db, userId);
    if (!applicant) throw new DomainError('not_found', 'The member has not started identity verification');
    await sumsub.requestCheck(applicant.applicantId);
    await withTransaction(this.db, (tx) =>
      writeAudit(tx, { type: 'operator', id: operatorId }, 'user.kyc_request_check', { type: 'user', id: userId }, null, {
        applicantId: applicant.applicantId,
        reason: text,
      }),
    );
  }

  /** The KYC tab of the member detail (KYC-4). */
  async forOperator(userId: string) {
    await this.assertUser(userId);
    const applicant = await this.applicant(this.db, userId);
    const webhooks = applicant
      ? await this.db.query(
          `SELECT type, payload->>'reviewStatus' AS review_status, received_at FROM sumsub_webhooks
           WHERE applicant_id = $1 ORDER BY id DESC LIMIT 20`,
          [applicant.applicantId],
        )
      : { rows: [] };
    return {
      configured: this.configured,
      applicant: applicant && {
        ...applicant,
        consoleUrl: sumsubConsoleUrl(applicant.applicantId),
      },
      webhooks: webhooks.rows.map((r) => ({ type: r.type, reviewStatus: r.review_status, receivedAt: r.received_at })),
    };
  }

  /** Connection state for the settings page (KYC-6). Keys are never shown. */
  async connection() {
    const { rows } = await this.db.query(
      `SELECT max(received_at) AS last_at,
              count(*) FILTER (WHERE received_at > now() - interval '24 hours')::int AS last_day
       FROM sumsub_webhooks`,
    );
    return {
      configured: this.configured,
      levelName: this.sumsub?.levelName ?? null,
      lastWebhookAt: rows[0]?.last_at ?? null,
      webhooksLast24h: rows[0]?.last_day ?? 0,
    };
  }

  /**
   * Stores the applicant's state and moves the member's KYC level when the result changes:
   * approval sets level 1 and the legal name; a final rejection takes level 1 away.
   */
  private async apply(tx: Tx, userId: string, a: SumsubApplicant, actor: Actor): Promise<void> {
    const user = await tx.query('SELECT kyc_level, legal_name FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const before = await tx.query('SELECT review_status, review_answer, reject_type FROM kyc_applicants WHERE user_id = $1', [
      userId,
    ]);
    await tx.query(
      `INSERT INTO kyc_applicants (user_id, applicant_id, level_name, review_status, review_answer, reject_type,
                                   reject_labels, moderation_comment, client_comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET applicant_id = $2, level_name = $3, review_status = $4, review_answer = $5,
         reject_type = $6, reject_labels = $7, moderation_comment = $8, client_comment = $9, updated_at = now()`,
      [
        userId,
        a.id,
        a.levelName,
        a.reviewStatus,
        a.reviewStatus === 'completed' ? a.reviewAnswer : null,
        a.reviewStatus === 'completed' && a.reviewAnswer === 'RED' ? a.rejectType : null,
        a.rejectLabels,
        a.moderationComment,
        a.clientComment,
      ],
    );
    if (a.reviewStatus !== 'completed' || !a.reviewAnswer) return;

    // Act only on a new result, so a repeat of an old one does not undo an operator's manual change.
    const prev = before.rows[0];
    const changed =
      !prev || prev.review_status !== 'completed' || prev.review_answer !== a.reviewAnswer || prev.reject_type !== a.rejectType;
    if (!changed) return;
    const level: number = user.rows[0].kyc_level;

    if (a.reviewAnswer === 'GREEN') {
      await tx.query('UPDATE users SET kyc_level = 1, legal_name = COALESCE($2, legal_name) WHERE id = $1', [
        userId,
        a.legalName,
      ]);
      await writeAudit(
        tx,
        actor,
        'user.kyc_approved',
        { type: 'user', id: userId },
        { kycLevel: level },
        { kycLevel: 1, applicantId: a.id, nameFromId: a.legalName !== null },
      );
      if (level < 1) await notify(tx, userId, 'kyc.approved', {});
      return;
    }

    const final = a.rejectType === 'FINAL';
    if (final && level >= 1) {
      await tx.query('UPDATE users SET kyc_level = 0 WHERE id = $1', [userId]);
      await writeAudit(
        tx,
        actor,
        'user.kyc_revoked',
        { type: 'user', id: userId },
        { kycLevel: level },
        { kycLevel: 0, applicantId: a.id, rejectLabels: a.rejectLabels },
      );
    }
    await notify(tx, userId, 'kyc.rejected', { final: final ? 'true' : 'false', comment: a.moderationComment });
  }

  private async applicant(q: Db | Tx, userId: string): Promise<KycApplicantView | null> {
    const { rows } = await q.query('SELECT * FROM kyc_applicants WHERE user_id = $1', [userId]);
    const r = rows[0];
    if (!r) return null;
    return {
      applicantId: r.applicant_id,
      levelName: r.level_name,
      reviewStatus: r.review_status,
      reviewAnswer: r.review_answer,
      rejectType: r.reject_type,
      rejectLabels: r.reject_labels,
      moderationComment: r.moderation_comment,
      clientComment: r.client_comment,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private async assertUser(userId: string): Promise<void> {
    const { rows } = await this.db.query('SELECT 1 FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new DomainError('not_found', 'User not found');
  }

  private require(): SumsubApi {
    if (!this.sumsub) throw new DomainError('kyc_unavailable', 'Identity verification is not set up yet');
    return this.sumsub;
  }
}
