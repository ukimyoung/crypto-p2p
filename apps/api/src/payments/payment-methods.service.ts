import { SecretBox } from '../auth/secret-box';
import { writeAudit } from '../common/audit';
import { DomainError } from '../common/errors';
import { Db, Tx, withTransaction } from '../db/database';

export interface PaymentMethodsConfig {
  /** Hours before a newly added account can receive payments (anti-fraud cooldown). */
  cooldownHours: number;
}

export interface AddBankAccountInput {
  fiat: string;
  /** 3-digit Korean bank code (KFTC), e.g. 004 for KB Kookmin. */
  bankCode: string;
  accountHolder: string;
  accountNumber: string;
}

export type ChangeBankAccountInput = Omit<AddBankAccountInput, 'fiat'>;

/** Masked view, safe to show anywhere. */
export interface PaymentMethod {
  id: string;
  type: 'bank_transfer';
  fiat: string;
  bankCode: string;
  accountHolder: string;
  accountMasked: string;
  usableFrom: Date;
}

/** Full details, shown only to the counterparty of an open order. */
export interface PaymentDetails {
  bankCode: string;
  accountHolder: string;
  accountNumber: string;
}

/**
 * Bank accounts that receive fiat (PAY-1). The holder must match the user's
 * KYC name, so third-party accounts cannot be used to receive payments. Each member has at most
 * one active account; they change its details instead of adding another.
 */
export class PaymentMethodsService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly config: PaymentMethodsConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async addBankAccount(userId: string, input: AddBankAccountInput): Promise<PaymentMethod> {
    const accountNumber = validateAccount(input);

    return withTransaction(this.db, async (tx) => {
      const legalName = await this.lockOwner(tx, userId, input.accountHolder);
      const existing = await tx.query(`SELECT 1 FROM payment_methods WHERE user_id = $1 AND status = 'active'`, [
        userId,
      ]);
      if (existing.rowCount) {
        throw new DomainError('payment_method_exists', 'You already have a bank account; change it instead');
      }

      const method = await this.insert(tx, userId, input.fiat, input.bankCode, legalName, accountNumber);
      await writeAudit(
        tx,
        { type: 'user', id: userId },
        'payment_method.add',
        { type: 'payment_method', id: method.id },
        null,
        method,
      );
      return method;
    });
  }

  /**
   * Replaces the member's account with new details. The old row is kept as `removed` so orders
   * already opened still show the account the buyer was told to pay into, while the member's open
   * ads move to the new account. The new account goes through the cooldown again.
   */
  async changeBankAccount(userId: string, id: string, input: ChangeBankAccountInput): Promise<PaymentMethod> {
    const accountNumber = validateAccount(input);

    return withTransaction(this.db, async (tx) => {
      const legalName = await this.lockOwner(tx, userId, input.accountHolder);
      const { rows } = await tx.query(
        `SELECT * FROM payment_methods WHERE id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE`,
        [id, userId],
      );
      if (!rows[0]) throw new DomainError('not_found', 'Payment method not found');
      const before = this.toMasked(rows[0]);

      await tx.query(`UPDATE payment_methods SET status = 'removed', removed_at = $2 WHERE id = $1`, [id, this.now()]);
      const method = await this.insert(tx, userId, before.fiat, input.bankCode, legalName, accountNumber);
      await tx.query(
        `UPDATE ads SET payment_method_id = $2 WHERE payment_method_id = $1 AND status <> 'closed'`,
        [id, method.id],
      );
      await writeAudit(
        tx,
        { type: 'user', id: userId },
        'payment_method.change',
        { type: 'payment_method', id: method.id },
        before,
        method,
      );
      return method;
    });
  }

  /** Locks the user row (one account change at a time) and returns the KYC name the holder must match. */
  private async lockOwner(tx: Tx, userId: string, accountHolder: string): Promise<string> {
    const { rows } = await tx.query<{ legal_name: string | null }>(
      'SELECT legal_name FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const legalName = rows[0]?.legal_name;
    if (!legalName) throw new DomainError('kyc_required', 'Complete identity verification first');
    if (normalizeName(accountHolder) !== normalizeName(legalName)) {
      throw new DomainError('holder_name_mismatch', 'The account holder must be you');
    }
    return legalName;
  }

  private async insert(
    tx: Tx,
    userId: string,
    fiat: string,
    bankCode: string,
    legalName: string,
    accountNumber: string,
  ): Promise<PaymentMethod> {
    const inserted = await tx.query(
      `INSERT INTO payment_methods (user_id, fiat, bank_code, account_holder, account_number_enc, account_last4, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, fiat, bankCode, legalName, this.secrets.seal(accountNumber), accountNumber.slice(-4), this.now()],
    );
    return this.toMasked(inserted.rows[0]);
  }

  async list(userId: string): Promise<PaymentMethod[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM payment_methods WHERE user_id = $1 AND status = 'active' ORDER BY created_at`,
      [userId],
    );
    return rows.map((r) => this.toMasked(r));
  }

  async remove(userId: string, id: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE payment_methods SET status = 'removed', removed_at = $3
       WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [id, userId, this.now()],
    );
    if (!rowCount) throw new DomainError('not_found', 'Payment method not found');
  }

  /** Throws unless the method belongs to the user, is active, fits the fiat and is past its cooldown. */
  async assertUsable(tx: Tx, userId: string, id: string, fiat: string): Promise<void> {
    const { rows } = await tx.query('SELECT * FROM payment_methods WHERE id = $1', [id]);
    const row = rows[0];
    if (!row || row.user_id !== userId || row.status !== 'active') {
      throw new DomainError('payment_method_invalid', 'Choose one of your active payment methods');
    }
    if (row.fiat !== fiat) throw new DomainError('payment_method_invalid', `This account does not take ${fiat}`);
    if (this.toMasked(row).usableFrom > this.now()) {
      throw new DomainError('payment_method_cooldown', 'A new payment method cannot receive payments yet');
    }
  }

  /** Decrypted details. Callers must check the viewer is entitled to see them. */
  async details(id: string): Promise<PaymentDetails> {
    const { rows } = await this.db.query('SELECT * FROM payment_methods WHERE id = $1', [id]);
    if (!rows[0]) throw new DomainError('not_found', 'Payment method not found');
    return {
      bankCode: rows[0].bank_code,
      accountHolder: rows[0].account_holder,
      accountNumber: this.secrets.open(rows[0].account_number_enc),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toMasked(row: any): PaymentMethod {
    return {
      id: row.id,
      type: row.type,
      fiat: row.fiat,
      bankCode: row.bank_code,
      accountHolder: row.account_holder,
      accountMasked: `****${row.account_last4}`,
      usableFrom: new Date(row.created_at.getTime() + this.config.cooldownHours * 3_600_000),
    };
  }
}

/** Checks the bank code and returns the account number with spaces and dashes taken out. */
function validateAccount(input: { bankCode: string; accountNumber: string }): string {
  if (!/^\d{3}$/.test(input.bankCode)) throw new DomainError('invalid_bank', 'Bank code must be 3 digits');
  const accountNumber = input.accountNumber.replace(/[\s-]/g, '');
  if (!/^\d{8,20}$/.test(accountNumber)) {
    throw new DomainError('invalid_account', 'Account number must be 8-20 digits');
  }
  return accountNumber;
}

/** Case, spacing and full-width differences do not count as a different name. */
export function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
