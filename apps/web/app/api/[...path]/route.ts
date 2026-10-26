import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Backend-for-frontend proxy. The browser never sees the bearer token: login
 * stores it in an httpOnly, SameSite=Strict cookie and every request to
 * /api/* is forwarded to the API with that token attached.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const COOKIE = 'p2p_session';
// Staff sessions use their own cookie so a customer login never reaches /ops and vice versa.
const OPS_COOKIE = 'p2p_ops_session';

async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  const isOps = path.startsWith('ops/');
  const cookieName = isOps ? OPS_COOKIE : COOKIE;
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const userAgent = req.headers.get('user-agent');
  if (userAgent) headers['User-Agent'] = userAgent;
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers['X-Forwarded-For'] = forwardedFor;
  // Sumsub signs the exact body bytes; pass its signature headers and the body through untouched.
  const isWebhook = path === 'kyc/sumsub/webhook';
  if (isWebhook) {
    for (const name of ['x-payload-digest', 'x-payload-digest-alg']) {
      const value = req.headers.get(name);
      if (value) headers[name] = value;
    }
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(`${API_URL}/${path}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: hasBody ? (isWebhook ? await req.arrayBuffer() : await req.text()) : undefined,
    cache: 'no-store',
  });

  // Signing up logs the new member in, like a login.
  if ((path === 'auth/login' || path === 'auth/signup' || path === 'ops/auth/login') && upstream.ok) {
    const { token: newToken, ...rest } = (await upstream.json()) as { token: string };
    const res = NextResponse.json({ ok: true, ...rest });
    res.cookies.set(cookieName, newToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: (isOps ? 8 : 12) * 3600,
    });
    return res;
  }

  const res =
    upstream.status === 204
      ? new NextResponse(null, { status: 204 })
      : new NextResponse(await upstream.text(), {
          status: upstream.status,
          headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
        });
  if (path === 'auth/logout' || path === 'ops/auth/logout' || upstream.status === 401) res.cookies.delete(cookieName);
  return res;
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
