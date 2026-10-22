import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../common/errors';

const STATUS: Record<string, number> = {
  unauthorized: 401,
  invalid_credentials: 401,
  otp_required: 401,
  forbidden: 403,
  account_closed: 403,
  kyc_required: 403,
  otp_not_enabled: 403,
  user_restricted: 403,
  holder_name_mismatch: 422,
  not_found: 404,
  email_taken: 409,
  address_exists: 409,
  invalid_transition: 409,
  too_many_attempts: 429,
};

/** Maps domain errors to `{ error: { code, message } }` with a fitting HTTP status. */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof DomainError) {
      res.status(STATUS[err.code] ?? 400).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json({ error: { code: 'http_error', message: err.message } });
      return;
    }
    this.logger.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  }
}
