import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { AuthGuard, AuthedRequest, CurrentUser } from './auth.guard';
import { parse } from './validation';

const credentials = z.object({ email: z.string(), password: z.string() });
const phoneFields = { phoneCountry: z.string(), phoneNumber: z.string().max(40) };
const signUpBody = credentials.extend({
  ...phoneFields,
  nickname: z.string().max(40),
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  locale: z.enum(['ko', 'en']).optional(),
});
const passwordBody = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) });
const nicknameBody = z.object({ nickname: z.string().max(40) });
const nameBody = z.object({ firstName: z.string().max(100), lastName: z.string().max(100) });
const phoneBody = z.object(phoneFields);
const localeBody = z.object({ locale: z.enum(['ko', 'en']) });

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Creates the account and returns a session token, like login. */
  @Post('auth/signup')
  @HttpCode(200)
  async signUp(@Body() body: unknown, @Req() req: Request) {
    const { email, password, phoneCountry, phoneNumber, nickname, firstName, lastName, locale } = parse(signUpBody, body);
    return this.auth.signUp(
      { email, password, phone: { country: phoneCountry, number: phoneNumber }, nickname, firstName, lastName, locale },
      { ip: req.ip, userAgent: req.get('user-agent') },
    );
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request) {
    const { email, password } = parse(credentials, body);
    const token = await this.auth.login(email, password, { ip: req.ip, userAgent: req.get('user-agent') });
    return { token };
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Req() req: AuthedRequest) {
    await this.auth.logout(req.token);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() userId: string) {
    return { user: await this.auth.me(userId) };
  }

  @Post('me/locale')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async setLocale(@CurrentUser() userId: string, @Body() body: unknown) {
    await this.auth.setLocale(userId, parse(localeBody, body).locale);
  }

  @Post('me/phone')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async setPhone(@CurrentUser() userId: string, @Body() body: unknown) {
    const { phoneCountry, phoneNumber } = parse(phoneBody, body);
    return { user: await this.auth.setPhone(userId, { country: phoneCountry, number: phoneNumber }) };
  }

  @Post('me/nickname')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async setNickname(@CurrentUser() userId: string, @Body() body: unknown) {
    return { user: await this.auth.setNickname(userId, parse(nicknameBody, body).nickname) };
  }

  @Post('me/password')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async changePassword(@CurrentUser() userId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { currentPassword, newPassword } = parse(passwordBody, body);
    await this.auth.changePassword(userId, currentPassword, newPassword, req.token, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  @Post('me/name')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async setName(@CurrentUser() userId: string, @Body() body: unknown) {
    const { firstName, lastName } = parse(nameBody, body);
    return { user: await this.auth.setName(userId, firstName, lastName) };
  }
}
