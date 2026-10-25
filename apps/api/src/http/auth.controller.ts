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
const emailBody = z.object({ email: z.string() });
const tokenBody = z.object({ token: z.string().max(200) });
const nicknameBody = z.object({ nickname: z.string().max(40) });
const phoneBody = z.object({ ...phoneFields, otp: z.string().optional() });
const loginBody = credentials.extend({ otp: z.string().optional() });
const otpBody = z.object({ code: z.string() });
const localeBody = z.object({ locale: z.enum(['ko', 'en']) });

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Emails a confirmation link. The account exists only once the link is opened. */
  @Post('auth/signup')
  @HttpCode(202)
  async signUp(@Body() body: unknown) {
    const { email, password, phoneCountry, phoneNumber, nickname, firstName, lastName, locale } = parse(signUpBody, body);
    return this.auth.signUp({
      email,
      password,
      phone: { country: phoneCountry, number: phoneNumber },
      nickname,
      firstName,
      lastName,
      locale,
    });
  }

  @Post('auth/signup/resend')
  @HttpCode(204)
  async resendSignUp(@Body() body: unknown) {
    await this.auth.resendSignUp(parse(emailBody, body).email);
  }

  /** Completes the signup from the emailed link and returns a session token, like login. */
  @Post('auth/signup/verify')
  @HttpCode(200)
  async verifySignUp(@Body() body: unknown, @Req() req: Request) {
    const { token } = parse(tokenBody, body);
    return this.auth.completeSignUp(token, { ip: req.ip, userAgent: req.get('user-agent') });
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request) {
    const { email, password, otp } = parse(loginBody, body);
    const token = await this.auth.login(email, password, otp, { ip: req.ip, userAgent: req.get('user-agent') });
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
    const { phoneCountry, phoneNumber, otp } = parse(phoneBody, body);
    return { user: await this.auth.setPhone(userId, { country: phoneCountry, number: phoneNumber }, otp) };
  }

  @Post('me/nickname')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async setNickname(@CurrentUser() userId: string, @Body() body: unknown) {
    return { user: await this.auth.setNickname(userId, parse(nicknameBody, body).nickname) };
  }

  @Post('auth/otp/setup')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  setupOtp(@CurrentUser() userId: string) {
    return this.auth.setupOtp(userId);
  }

  @Post('auth/otp/enable')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async enableOtp(@CurrentUser() userId: string, @Body() body: unknown) {
    await this.auth.enableOtp(userId, parse(otpBody, body).code);
  }
}
