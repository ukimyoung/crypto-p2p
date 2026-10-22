import { z } from 'zod';
import { DomainError } from '../common/errors';

/** Integer amount in smallest units, sent as a decimal string so it survives JSON. */
export const amountString = z
  .string()
  .regex(/^[1-9]\d{0,40}$/, 'must be a positive integer string')
  .transform((s) => BigInt(s));

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new DomainError('invalid_request', `${issue?.path.join('.') || 'body'}: ${issue?.message}`);
  }
  return result.data;
}
