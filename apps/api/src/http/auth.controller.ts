import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { AuthGuard, AuthedRequest, CurrentUser } from './auth.guard';
import { parse } from './validation';

const credentials = z.object({ email: z.string(), password: z.string() });
const phoneFields = { phoneCountry: z.string(), phoneNumber: z.string().max(40) };
const signUpBody = credentials.extend(phoneFields);
const phoneBody = z.object({ ...phoneFields, otp: z.string().optional() });
const loginBody = credentials.extend({ otp: z.string().optional() });
const otpBody = z.object({ code: z.string() });
const localeBody = z.object({ locale: z.enum(['ko', 'en']) });

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('auth/signup')
  async signUp(@Body() body: unknown) {
    const { email, password, phoneCountry, phoneNumber } = parse(signUpBody, body);
    return { user: await this.auth.signUp(email, password, { country: phoneCountry, number: phoneNumber }) };
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
