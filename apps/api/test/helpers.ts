import { randomBytes } from 'node:crypto';
import { AuthService, Me } from '../src/auth/auth.service';
import { SecretBox } from '../src/auth/secret-box';
import { createPool, Db, withTransaction } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { LedgerService } from '../src/ledger/ledger.service';
import { EmailMessage, EmailSender } from '../src/notifications/email.worker';
import { PaymentMethodsService } from '../src/payments/payment-methods.service';

export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/p2p_test';

/** Fresh schema for each test file. */
export async function setupDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL);
  await db.query('DROP SCHEMA IF EXISTS public CASCADE');
  await db.query('CREATE SCHEMA public');
  await migrate(db);
  return db;
}

export async function createUser(db: Db, kycLevel = 1): Promise<string> {
  const { rows } = await db.query<{ id: string }>('INSERT INTO users (kyc_level) VALUES ($1) RETURNING id', [kycLevel]);
  return rows[0]!.id;
}

let phoneSeq = 0;

/** A Korean mobile number no other test member has, as the sign-up form sends it. */
export function nextPhone(): { phoneCountry: string; phoneNumber: string } {
  return { phoneCountry: 'KR', phoneNumber: `010-5555-${String(++phoneSeq).padStart(4, '0')}` };
}

let nicknameSeq = 0;

/** A nickname no other test member has. */
export function nextNickname(): string {
  return `member_${++nicknameSeq}`;
}

/** The same, in the shape `AuthService.signUp` takes. */
export function nextPhoneInput(): { country: string; number: string } {
  const { phoneCountry, phoneNumber } = nextPhone();
  return { country: phoneCountry, number: phoneNumber };
}

/** First and last name, as the sign-up form sends them. */
export const NAME = { firstName: 'Gildong', lastName: 'Hong' };

let depositSeq = 0;

/** Simulates a confirmed on-chain deposit until the wallet module exists. */
export async function deposit(db: Db, ledger: LedgerService, userId: string, asset: string, amount: bigint) {
  await withTransaction(db, (tx) =>
    ledger.post(tx, {
      idempotencyKey: `test-deposit:${++depositSeq}:${userId}`,
      kind: 'deposit',
      postings: [
        { account: { system: 'custody', asset }, amount: -amount },
        { account: { userId, asset, kind: 'available' }, amount },
      ],
    }),
  );
}

export const BTC = 100_000_000n; // satoshi per BTC

let accountSeq = 0;

/** Marks the user KYC-verified under `legalName` and registers a KRW bank account in that name. */
export async function addBankAccount(
  db: Db,
  payments: PaymentMethodsService,
  userId: string,
  legalName = '홍길동',
): Promise<string> {
  await db.query('UPDATE users SET legal_name = $2 WHERE id = $1', [userId, legalName]);
  const method = await payments.addBankAccount(userId, {
    fiat: 'KRW',
    bankCode: '004',
    accountHolder: legalName,
    accountNumber: `1002${String(++accountSeq).padStart(8, '0')}`,
  });
  return method.id;
}

export function testSecretBox(): SecretBox {
  return new SecretBox(randomBytes(32).toString('base64'));
}

/** Keeps sent emails in memory so tests can check them. */
export class MemoryEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  fail = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.fail) throw new Error('mail server down');
    this.sent.push(message);
  }
}

/** Signs a member up through the service, as the signup form does. */
export async function signUpMember(auth: AuthService, email: string, password: string): Promise<Me> {
  return (await auth.signUp({ email, password, phone: nextPhoneInput(), nickname: nextNickname(), ...NAME }, {})).user;
}
