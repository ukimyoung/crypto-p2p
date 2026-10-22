import { SecretBox } from '../auth/secret-box';
import { createPool } from '../db/database';
import { OperatorAuthService, OperatorRole } from './operator-auth.service';

/**
 * Creates a staff account. There is no sign-up page for operators.
 *
 *   OPERATOR_PASSWORD=... node dist/ops/create-operator-cli.js <email> <name> <support|reviewer|admin>
 *
 * Prints the OTP secret once; it must go into the operator's authenticator app.
 */
async function main() {
  const [email, name, role] = process.argv.slice(2);
  const password = process.env.OPERATOR_PASSWORD;
  if (!email || !name || !role || !password) {
    throw new Error('Usage: OPERATOR_PASSWORD=... create-operator <email> <name> <support|reviewer|admin>');
  }
  const url = process.env.DATABASE_URL;
  const key = process.env.OTP_ENCRYPTION_KEY;
  if (!url || !key) throw new Error('DATABASE_URL and OTP_ENCRYPTION_KEY must be set');

  const db = createPool(url);
  try {
    const auth = new OperatorAuthService(db, new SecretBox(key), {
      sessionTtlHours: 8,
      maxFailedLogins: 5,
      lockoutMinutes: 15,
    });
    const created = await auth.create({ email, name, role: role as OperatorRole, password });
    console.log(`Created ${created.operator.role} ${created.operator.email} (${created.operator.id})`);
    console.log(`OTP secret: ${created.otpSecret}`);
    console.log(`OTP URL:    ${created.otpauthUrl}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
