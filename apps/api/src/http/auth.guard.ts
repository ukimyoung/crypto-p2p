import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { DomainError } from '../common/errors';

export type AuthedRequest = Request & { userId: string; token: string };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    const userId = match ? await this.auth.authenticate(match[1]!) : null;
    if (!userId) throw new DomainError('unauthorized', 'Login required');
    req.userId = userId;
    req.token = match![1]!;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().userId,
);
