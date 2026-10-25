import { hashPassword } from '../auth/password';
import { SecretBox } from '../auth/secret-box';
import { AdsService } from '../ads/ads.service';
import { createPool, Db, withTransaction } from '../db/database';
import { migrate } from '../db/migrate';
import { LedgerService } from '../ledger/ledger.service';
import { OrderChatService } from '../orders/order-chat.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { WalletService } from '../wallet/wallet.service';
import { DEMO_OPERATORS, DEMO_PASSWORD, DEMO_TESTERS, DEMO_USERS } from './accounts';

const BTC = 100_000_000n;
const USDT = 1_000_000n;

/**
 * Fills an empty database with demo accounts, balances, ads, an order under
 * review and a withdrawal waiting for approval. Does nothing if the demo
 * accounts already exist.
 *
 *   DEMO_SEED=yes node dist/demo/seed-cli.js
 */
async function main() {
  if (process.env.DEMO_SEED !== 'yes') throw new Error('Set DEMO_SEED=yes. Never run this against a real database.');
  const url = process.env.DATABASE_URL;
  const key = process.env.OTP_ENCRYPTION_KEY;
  if (!url || !key) throw new Error('DATABASE_URL and OTP_ENCRYPTION_KEY must be set');
  const db = createPool(url);
  try {
    await migrate(db);
    const secrets = new SecretBox(key);
    const { rows } = await db.query('SELECT 1 FROM users WHERE email = $1', [DEMO_USERS[0].email]);
    if (rows[0]) {
      console.log('Demo data already exists');
    } else {
      await seed(db, secrets);
      console.log('Demo data created');
    }
    await addTesters(db);
  } finally {
    await db.end();
  }
}

/** Adds the empty tester accounts that are missing. Skips one whose email, phone or nickname is taken. */
async function addTesters(db: Db) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const u of DEMO_TESTERS) {
    const { rowCount } = await db.query(
      `INSERT INTO users (email, password_hash, phone, phone_country, kyc_level, legal_name, nickname,
                          email_verified_at, first_name, last_name)
       VALUES ($1, $2, $3, 'KR', 1, $4, $5, now(), $6, $7)
       ON CONFLICT DO NOTHING`,
      [u.email, passwordHash, u.phone, u.legalName, u.nickname, u.firstName, u.lastName],
    );
    if (rowCount) console.log(`Demo tester ${u.email} created`);
  }
}

async function seed(db: Db, secrets: SecretBox) {
  const ledger = new LedgerService();
  const payments = new PaymentMethodsService(db, secrets, { cooldownHours: 0 });
  const ads = new AdsService(db, payments);
  const orders = new OrdersService(db, ledger, payments);
  const chat = new OrderChatService(db);
  const wallet = new WalletService(db, ledger, { addressCooldownHours: 0 });
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const ids: string[] = [];
  for (const u of DEMO_USERS) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, phone, phone_country, kyc_level, legal_name, nickname,
                          first_name, last_name)
       VALUES ($1, $2, $3, 'KR', 1, $4, $5, $6, $7) RETURNING id`,
      [u.email, passwordHash, u.phone, u.legalName, u.nickname, u.firstName, u.lastName],
    );
    ids.push(rows[0]!.id);
  }
  const [seller, buyer] = ids as [string, string];
  for (const op of DEMO_OPERATORS) {
    await db.query(
      `INSERT INTO operators (email, name, role, password_hash, otp_secret_enc) VALUES ($1, $2, $3, $4, $5)`,
      [op.email, op.name, op.role, passwordHash, secrets.seal(op.otpSecret)],
    );
  }

  // Stands in for on-chain deposits until the custody integration exists.
  const deposit = (userId: string, asset: string, amount: bigint) =>
    withTransaction(db, (tx) =>
      ledger.post(tx, {
        idempotencyKey: `demo-deposit:${userId}:${asset}`,
        kind: 'deposit',
        postings: [
          { account: { system: 'custody', asset }, amount: -amount },
          { account: { userId, asset, kind: 'available' }, amount },
        ],
      }),
    );
  await deposit(seller, 'BTC', 2n * BTC);
  await deposit(seller, 'USDT', 20_000n * USDT);
  await deposit(buyer, 'BTC', BTC / 2n);

  const sellerBank = await payments.addBankAccount(seller, {
    fiat: 'KRW',
    bankCode: '004',
    accountHolder: '김판매',
    accountNumber: '123456789012',
  });
  await payments.addBankAccount(buyer, {
    fiat: 'KRW',
    bankCode: '090',
    accountHolder: '이구매',
    accountNumber: '333312345678',
  });

  const btcAd = await ads.create({
    makerId: seller,
    side: 'sell',
    asset: 'BTC',
    fiat: 'KRW',
    priceMinor: 145_000_000n,
    totalAmount: BTC,
    minOrderFiatMinor: 10_000n,
    maxOrderFiatMinor: 50_000_000n,
    paymentMethodId: sellerBank.id,
  });
  await ads.create({
    makerId: seller,
    side: 'sell',
    asset: 'USDT',
    fiat: 'KRW',
    priceMinor: 1_400n,
    totalAmount: 10_000n * USDT,
    minOrderFiatMinor: 10_000n,
    maxOrderFiatMinor: 5_000_000n,
    paymentMethodId: sellerBank.id,
  });
  await ads.create({
    makerId: buyer,
    side: 'buy',
    asset: 'BTC',
    fiat: 'KRW',
    priceMinor: 143_000_000n,
    totalAmount: BTC / 10n,
    minOrderFiatMinor: 10_000n,
    maxOrderFiatMinor: 10_000_000n,
  });

  // An order the buyer says they paid for, now waiting on the ops team.
  const disputed = await orders.create(buyer, btcAd.id, BTC / 100n);
  await chat.post(disputed.id, buyer, '1,450,000원 이체했습니다. 확인 부탁드려요.');
  await orders.markPaid(disputed.id, buyer);
  await chat.post(disputed.id, seller, '입금이 아직 안 보입니다.');
  await orders.escalate(disputed.id, buyer);

  // A withdrawal above the auto-approve amount, waiting for review.
  const address = await wallet.setAddress(seller, {
    asset: 'BTC',
    address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  });
  await wallet.requestWithdrawal(seller, address.id, BTC / 2n);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
