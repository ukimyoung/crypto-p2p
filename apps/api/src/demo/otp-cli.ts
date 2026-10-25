import { codeAt, counterAt } from '../auth/totp';
import { DEMO_OPERATORS } from './accounts';

/**
 * Prints the current OTP code for each demo operator, so the ops console can be
 * tried without an authenticator app. Members do not use OTP. Each code works once.
 *
 *   node dist/demo/otp-cli.js
 */
const counter = counterAt(new Date());
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
for (const a of DEMO_OPERATORS) {
  console.log(`${a.email.padEnd(22)} ${codeAt(a.otpSecret, counter)}   next ${codeAt(a.otpSecret, counter + 1)}`);
}
console.log(`Current codes change in ${left}s.`);
