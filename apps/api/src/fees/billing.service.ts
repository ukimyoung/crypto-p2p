import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';
import { notify } from '../notifications/notify';
import { billingSettings } from '../ops/ops-settings';

/** Billing days and months follow Korea time. */
const TZ = 'Asia/Seoul';

export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'overdue';

export interface FeeInvoice {
  id: string;
  makerId: string;
  makerEmail: string | null;
  fiat: string;
  periodStart: Date;
  periodEnd: Date;
  totalMinor: bigint;
  paidMinor: bigint;
  status: InvoiceStatus;
  dueAt: Date;
  issuedAt: Date;
  paidAt: Date | null;
}

export interface FeePayment {
  id: string;
  amountMinor: bigint;
  paidAt: Date;
  memo: string;
  operatorId: string;
  operatorEmail: string | null;
  createdAt: Date;
}

export interface InvoiceOrder {
  id: string;
  orderNumber: string;
  asset: string;
  amount: bigint;
  basePriceMinor: bigint;
  feeRateBp: number;
  fiatAmountMinor: bigint;
  feeFiatMinor: bigint;
  completedAt: Date;
}

export interface InvoiceDetail {
  invoice: FeeInvoice;
  orders: InvoiceOrder[];
  payments: FeePayment[];
}

export interface FeeSummary {
  fiat: string;
  /** Fees of orders completed in the range. */
  earnedMinor: bigint;
  /** Of those, not on an invoice yet. */
  unbilledMinor: bigint;
  /** Payments recorded in the range. */
  paidMinor: bigint;
  /** Unpaid on all open invoices, whenever they were issued. */
  outstandingMinor: bigint;
  overdueMinor: bigint;
}

export interface MakerOutstanding {
  makerId: string;
  makerEmail: string | null;
  fiat: string;
  outstandingMinor: bigint;
  overdueMinor: bigint;
  invoices: number;
}

/**
 * Maker fees are billed, not taken from the trade (FEE-5 to FEE-8): fees of completed
 * orders pile up, an invoice per maker and fiat is issued when a billing period ends,
 * a reviewer records payments made outside the system, and a maker with an overdue
 * invoice has their ads hidden until it is paid in full.
 */
export class BillingService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** One pass of the billing worker. */
  async run(): Promise<{ issued: number; reminded: number; overdue: number }> {
    const issued = await this.issueInvoices();
    const reminded = await this.sendReminders();
    const overdue = await this.markOverdue();
    return { issued, reminded, overdue };
  }

  /** Bills every fee from a period that has ended. */
  async issueInvoices(): Promise<number> {
    const now = this.now();
    const { cycle, dueDays } = await billingSettings(this.db);
    const unit = cycle === 'daily' ? 'day' : 'month';
    const { rows: groups } = await this.db.query<{ maker_id: string; fiat: string; period_start: Date; period_end: Date }>(
      `SELECT maker_id, fiat,
              date_trunc($1, completed_at AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}' AS period_start,
              (date_trunc($1, completed_at AT TIME ZONE '${TZ}') + ('1 ' || $1)::interval) AT TIME ZONE '${TZ}' AS period_end
       FROM orders
       WHERE status = 'completed' AND fee_fiat_minor > 0 AND fee_invoice_id IS NULL
         AND completed_at < date_trunc($1, $2::timestamptz AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'
       GROUP BY 1, 2, 3, 4
       ORDER BY 3`,
      [unit, now],
    );
    let issued = 0;
    for (const g of groups) {
      const done = await withTransaction(this.db, async (tx) => {
        const { rows: orders } = await tx.query<{ id: string; fee_fiat_minor: string }>(
          `SELECT id, fee_fiat_minor FROM orders
           WHERE maker_id = $1 AND fiat = $2 AND status = 'completed' AND fee_fiat_minor > 0
             AND fee_invoice_id IS NULL AND completed_at >= $3 AND completed_at < $4
           FOR UPDATE SKIP LOCKED`,
          [g.maker_id, g.fiat, g.period_start, g.period_end],
        );
        if (!orders.length) return false;
        const total = orders.reduce((sum, o) => sum + BigInt(o.fee_fiat_minor), 0n);
        // Due at the end of the day `dueDays` after today.
        const { rows } = await tx.query(
          `INSERT INTO fee_invoices (maker_id, fiat, period_start, period_end, total_minor, due_at, issued_at)
           VALUES ($1, $2, $3, $4, $5,
                   (date_trunc('day', $6::timestamptz AT TIME ZONE '${TZ}') + make_interval(days => $7 + 1)) AT TIME ZONE '${TZ}',
                   $6)
           RETURNING *`,
          [g.maker_id, g.fiat, g.period_start, g.period_end, total.toString(), now, dueDays],
        );
        const invoice = toInvoice(rows[0]);
        await tx.query('UPDATE orders SET fee_invoice_id = $1 WHERE id = ANY($2::uuid[])', [
          invoice.id,
          orders.map((o) => o.id),
        ]);
        await writeAudit(tx, { type: 'system' }, 'fee.invoice_issue', { type: 'fee_invoice', id: invoice.id }, null, {
          ...invoice,
          orders: orders.length,
        });
        await notify(tx, invoice.makerId, 'fee.invoice_issued', invoiceData(invoice));
        return true;
      });
      if (done) issued++;
    }
    return issued;
  }

  /** Reminds makers the day before the due date and on the day itself. */
  async sendReminders(): Promise<number> {
    const now = this.now();
    let sent = 0;
    for (const [column, daysBefore] of [
      ['reminded_before_at', 2],
      ['reminded_due_at', 1],
    ] as const) {
      const { rows } = await this.db.query(
        `UPDATE fee_invoices SET ${column} = $1
         WHERE status IN ('issued', 'partially_paid') AND ${column} IS NULL
           AND due_at - make_interval(days => $2) <= $1 AND due_at > $1
         RETURNING *`,
        [now, daysBefore],
      );
      for (const row of rows) {
        const invoice = toInvoice(row);
        await withTransaction(this.db, (tx) =>
          notify(tx, invoice.makerId, 'fee.invoice_due_soon', {
            ...invoiceData(invoice),
            when: daysBefore === 2 ? 'tomorrow' : 'today',
          }),
        );
        sent++;
      }
    }
    return sent;
  }

  /** Invoices past due become overdue; the maker's ads stop showing (see `onFeeHold`). */
  async markOverdue(): Promise<number> {
    const now = this.now();
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM fee_invoices WHERE status IN ('issued', 'partially_paid') AND due_at <= $1`,
      [now],
    );
    let marked = 0;
    for (const { id } of rows) {
      const done = await withTransaction(this.db, async (tx) => {
        const res = await tx.query(
          `UPDATE fee_invoices SET status = 'overdue'
           WHERE id = $1 AND status IN ('issued', 'partially_paid') AND due_at <= $2 RETURNING *`,
          [id, now],
        );
        if (!res.rows[0]) return false;
        const invoice = toInvoice(res.rows[0]);
        await writeAudit(tx, { type: 'system' }, 'fee.invoice_overdue', { type: 'fee_invoice', id }, null, invoice);
        await notify(tx, invoice.makerId, 'fee.invoice_overdue', invoiceData(invoice));
        return true;
      });
      if (done) marked++;
    }
    return marked;
  }

  /**
   * Records a payment confirmed outside the system (FEE-7). A partial payment leaves the
   * rest unpaid; an invoice already overdue stays overdue until it is paid in full.
   */
  async recordPayment(
    invoiceId: string,
    input: { amountMinor: bigint; paidAt: Date; memo: string },
    operatorId: string,
  ): Promise<InvoiceDetail> {
    if (input.amountMinor <= 0n) throw new DomainError('invalid_amount', 'Amount must be positive');
    if (input.paidAt.getTime() > this.now().getTime() + 60_000) {
      throw new DomainError('invalid_request', 'The payment date cannot be in the future');
    }
    await withTransaction(this.db, async (tx) => {
      const res = await tx.query('SELECT * FROM fee_invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
      if (!res.rows[0]) throw new DomainError('not_found', 'Invoice not found');
      const before = toInvoice(res.rows[0]);
      if (before.status === 'paid') throw new DomainError('invalid_transition', 'The invoice is already paid');
      const paid = before.paidMinor + input.amountMinor;
      if (paid > before.totalMinor) {
        throw new DomainError('invalid_amount', 'The payment is more than what is left on the invoice');
      }
      const status: InvoiceStatus =
        paid === before.totalMinor ? 'paid' : before.status === 'overdue' ? 'overdue' : 'partially_paid';
      await tx.query(
        `INSERT INTO fee_payments (invoice_id, amount_minor, paid_at, memo, operator_id) VALUES ($1, $2, $3, $4, $5)`,
        [invoiceId, input.amountMinor.toString(), input.paidAt, input.memo.trim(), operatorId],
      );
      const updated = await tx.query(
        `UPDATE fee_invoices SET paid_minor = $2, status = $3, paid_at = CASE WHEN $3 = 'paid' THEN $4 ELSE paid_at END
         WHERE id = $1 RETURNING *`,
        [invoiceId, paid.toString(), status, input.paidAt],
      );
      const after = toInvoice(updated.rows[0]);
      await writeAudit(
        tx,
        { type: 'operator', id: operatorId },
        'fee.payment_record',
        { type: 'fee_invoice', id: invoiceId },
        before,
        { ...after, payment: { amountMinor: input.amountMinor, paidAt: input.paidAt, memo: input.memo.trim() } },
      );
      if (status === 'paid') await notify(tx, after.makerId, 'fee.invoice_paid', invoiceData(after));
    });
    return (await this.get(invoiceId))!;
  }

  async list(filter: {
    status?: InvoiceStatus;
    makerId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ invoices: FeeInvoice[]; total: number }> {
    const pageSize = Math.min(filter.pageSize ?? 20, 100);
    const page = Math.max(filter.page ?? 1, 1);
    const { rows } = await this.db.query(
      `SELECT i.*, u.email AS maker_email, count(*) OVER () AS total_count
       FROM fee_invoices i JOIN users u ON u.id = i.maker_id
       WHERE ($1::text IS NULL OR i.status = $1) AND ($2::uuid IS NULL OR i.maker_id = $2)
       ORDER BY i.issued_at DESC, i.id
       LIMIT $3 OFFSET $4`,
      [filter.status ?? null, filter.makerId ?? null, pageSize, (page - 1) * pageSize],
    );
    return { invoices: rows.map(toInvoice), total: Number(rows[0]?.total_count ?? 0) };
  }

  async get(invoiceId: string): Promise<InvoiceDetail | null> {
    const res = await this.db.query(
      'SELECT i.*, u.email AS maker_email FROM fee_invoices i JOIN users u ON u.id = i.maker_id WHERE i.id = $1',
      [invoiceId],
    );
    if (!res.rows[0]) return null;
    const orders = await this.db.query(
      `SELECT id, order_number, asset, amount, base_price_minor, fee_rate_bp, fiat_amount_minor, fee_fiat_minor, completed_at
       FROM orders WHERE fee_invoice_id = $1 ORDER BY completed_at`,
      [invoiceId],
    );
    const payments = await this.db.query(
      `SELECT p.*, o.email AS operator_email FROM fee_payments p JOIN operators o ON o.id = p.operator_id
       WHERE p.invoice_id = $1 ORDER BY p.paid_at, p.created_at`,
      [invoiceId],
    );
    return {
      invoice: toInvoice(res.rows[0]),
      orders: orders.rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        asset: r.asset,
        amount: BigInt(r.amount),
        basePriceMinor: BigInt(r.base_price_minor),
        feeRateBp: r.fee_rate_bp,
        fiatAmountMinor: BigInt(r.fiat_amount_minor),
        feeFiatMinor: BigInt(r.fee_fiat_minor),
        completedAt: r.completed_at,
      })),
      payments: payments.rows.map((r) => ({
        id: r.id,
        amountMinor: BigInt(r.amount_minor),
        paidAt: r.paid_at,
        memo: r.memo,
        operatorId: r.operator_id,
        operatorEmail: r.operator_email,
        createdAt: r.created_at,
      })),
    };
  }

  /** A maker's own invoices, newest first, and the fees not billed yet. */
  async forMaker(makerId: string): Promise<{ invoices: FeeInvoice[]; unbilled: { fiat: string; amountMinor: bigint }[] }> {
    const { rows } = await this.db.query(
      'SELECT * FROM fee_invoices WHERE maker_id = $1 ORDER BY issued_at DESC LIMIT 100',
      [makerId],
    );
    const unbilled = await this.db.query<{ fiat: string; total: string }>(
      `SELECT fiat, sum(fee_fiat_minor) AS total FROM orders
       WHERE maker_id = $1 AND status = 'completed' AND fee_fiat_minor > 0 AND fee_invoice_id IS NULL
       GROUP BY fiat ORDER BY fiat`,
      [makerId],
    );
    return {
      invoices: rows.map(toInvoice),
      unbilled: unbilled.rows.map((r) => ({ fiat: r.fiat, amountMinor: BigInt(r.total) })),
    };
  }

  /** Totals per fiat for orders completed and payments recorded in [from, to). */
  async summary(from: Date, to: Date): Promise<{ totals: FeeSummary[]; makers: MakerOutstanding[] }> {
    const { rows } = await this.db.query(
      `WITH fiats AS (SELECT code AS fiat FROM fiat_currencies),
       earned AS (
         SELECT fiat, sum(fee_fiat_minor) AS earned,
                sum(fee_fiat_minor) FILTER (WHERE fee_invoice_id IS NULL) AS unbilled
         FROM orders WHERE status = 'completed' AND completed_at >= $1 AND completed_at < $2 GROUP BY fiat),
       paid AS (
         SELECT i.fiat, sum(p.amount_minor) AS paid
         FROM fee_payments p JOIN fee_invoices i ON i.id = p.invoice_id
         WHERE p.paid_at >= $1 AND p.paid_at < $2 GROUP BY i.fiat),
       open AS (
         SELECT fiat, sum(total_minor - paid_minor) AS outstanding,
                sum(total_minor - paid_minor) FILTER (WHERE status = 'overdue') AS overdue
         FROM fee_invoices WHERE status <> 'paid' GROUP BY fiat)
       SELECT f.fiat, COALESCE(e.earned, 0) AS earned, COALESCE(e.unbilled, 0) AS unbilled,
              COALESCE(p.paid, 0) AS paid, COALESCE(o.outstanding, 0) AS outstanding, COALESCE(o.overdue, 0) AS overdue
       FROM fiats f LEFT JOIN earned e USING (fiat) LEFT JOIN paid p USING (fiat) LEFT JOIN open o USING (fiat)
       ORDER BY f.fiat`,
      [from, to],
    );
    const makers = await this.db.query(
      `SELECT i.maker_id, u.email, i.fiat, sum(i.total_minor - i.paid_minor) AS outstanding,
              COALESCE(sum(i.total_minor - i.paid_minor) FILTER (WHERE i.status = 'overdue'), 0) AS overdue,
              count(*) AS invoices
       FROM fee_invoices i JOIN users u ON u.id = i.maker_id
       WHERE i.status <> 'paid'
       GROUP BY i.maker_id, u.email, i.fiat
       ORDER BY overdue DESC, outstanding DESC
       LIMIT 100`,
    );
    return {
      totals: rows.map((r) => ({
        fiat: r.fiat,
        earnedMinor: BigInt(r.earned),
        unbilledMinor: BigInt(r.unbilled),
        paidMinor: BigInt(r.paid),
        outstandingMinor: BigInt(r.outstanding),
        overdueMinor: BigInt(r.overdue),
      })),
      makers: makers.rows.map((r) => ({
        makerId: r.maker_id,
        makerEmail: r.email,
        fiat: r.fiat,
        outstandingMinor: BigInt(r.outstanding),
        overdueMinor: BigInt(r.overdue),
        invoices: Number(r.invoices),
      })),
    };
  }
}

/** True while the maker has an overdue fee invoice: their ads are hidden and they cannot post new ones. */
export async function onFeeHold(q: Db | Tx, makerId: string): Promise<boolean> {
  const { rows } = await q.query(`SELECT 1 FROM fee_invoices WHERE maker_id = $1 AND status = 'overdue' LIMIT 1`, [
    makerId,
  ]);
  return rows.length > 0;
}

/** SQL condition for "the maker of ad `alias` is not on a fee hold". */
export const NOT_ON_FEE_HOLD = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM fee_invoices fi WHERE fi.maker_id = ${alias}.maker_id AND fi.status = 'overdue')`;

function invoiceData(invoice: FeeInvoice) {
  return {
    invoiceId: invoice.id,
    fiat: invoice.fiat,
    amountMinor: (invoice.totalMinor - invoice.paidMinor).toString(),
    totalMinor: invoice.totalMinor.toString(),
    dueAt: invoice.dueAt.toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toInvoice(row: any): FeeInvoice {
  return {
    id: row.id,
    makerId: row.maker_id,
    makerEmail: row.maker_email ?? null,
    fiat: row.fiat,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    totalMinor: BigInt(row.total_minor),
    paidMinor: BigInt(row.paid_minor),
    status: row.status,
    dueAt: row.due_at,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
  };
}
