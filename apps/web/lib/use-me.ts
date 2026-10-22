'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Me } from './types';

/** Current user, or null when logged out. `undefined` while loading. */
export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      setMe((await api<{ user: Me }>('me')).user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else throw err;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { me, reload };
}
