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

/** Reviewers and admins can act; support staff can only look. */
export const canAct = (operator: Operator | null | undefined) =>
  operator?.role === 'reviewer' || operator?.role === 'admin';
