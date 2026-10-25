import { codeAt, counterAt } from '../auth/totp';
import { DEMO_OPERATORS, DEMO_TESTERS, DEMO_USERS } from './accounts';

/**
 * Prints the current OTP code for each demo account, so the demo can be
 * tried without an authenticator app. Each code works once.
 *
 *   node dist/demo/otp-cli.js
 */
const counter = counterAt(new Date());
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
for (const a of [...DEMO_USERS, ...DEMO_TESTERS, ...DEMO_OPERATORS]) {
  console.log(`${a.email.padEnd(22)} ${codeAt(a.otpSecret, counter)}   next ${codeAt(a.otpSecret, counter + 1)}`);
}
console.log(`Current codes change in ${left}s.`);
