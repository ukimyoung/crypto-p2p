import { errorText } from './messages';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Calls the API through this app's `/api` proxy, which attaches the session
 * from an httpOnly cookie. Throws ApiError with a Korean message on failure.
 */
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api/${path.replace(/^\//, '')}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code ?? 'unknown';
    throw new ApiError(res.status, code, errorText(code, data?.error?.message ?? '요청을 처리하지 못했습니다.'));
  }
  return data as T;
}
