import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '../common/errors';
import { Operator, OperatorAuthService } from '../ops/operator-auth.service';

export type OpsRequest = Request & { operator: Operator; token: string };

/** Staff sessions only. Customer tokens are not valid here. */
@Injectable()
export class OpsGuard implements CanActivate {
  constructor(@Inject(OperatorAuthService) private readonly auth: OperatorAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OpsRequest>();
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    const operator = match ? await this.auth.authenticate(match[1]!) : null;
    if (!operator) throw new DomainError('unauthorized', 'Operator login required');
    req.operator = operator;
    req.token = match![1]!;
    return true;
  }
}

export const CurrentOperator = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<OpsRequest>().operator,
);
