import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthGuard, CurrentUser } from './auth.guard';
import { parse } from './validation';

const readBody = z.object({ upToId: z.string().regex(/^\d+$/) });

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.notifications.list(userId);
  }

  @Get('unread-count')
  async unread(@CurrentUser() userId: string) {
    return { unread: await this.notifications.unreadCount(userId) };
  }

  @Post('read')
  @HttpCode(204)
  async read(@CurrentUser() userId: string, @Body() body: unknown) {
    await this.notifications.markRead(userId, parse(readBody, body).upToId);
  }
}
