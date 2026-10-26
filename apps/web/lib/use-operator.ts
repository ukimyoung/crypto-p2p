'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Operator } from './types';

/** Logged-in staff member, or null. `undefined` while loading. */
export function useOperator() {
  const [operator, setOperator] = useState<Operator | null | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      setOperator((await api<{ operator: Operator }>('ops/me')).operator);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setOperator(null);
      else throw err;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { operator, reload };
}

/** Administrators also manage markets, billing runs and operator accounts. */
export const isAdmin = (operator: Operator | null | undefined) => operator?.role === 'administrator';

/**
 * Runs a console action. Moving money and changing limits need a fresh OTP code:
 * when the API asks for one, prompts for it, unlocks the session and retries once.
 * Returns undefined if the operator cancels the prompt.
 */
export async function withStepUp<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'step_up_required') throw err;
    const otp = window.prompt('보안을 위해 OTP 코드 6자리를 입력해 주세요. 5분 동안 다시 묻지 않습니다.');
    if (!otp) return undefined;
    await api('ops/auth/step-up', { body: { otp: otp.trim() } });
    return action();
  }
}
