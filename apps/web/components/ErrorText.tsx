'use client';

import { useT } from '@/lib/i18n';

/** Error messages are Korean source text (see lib/messages.ts), translated here. */
export function ErrorText({ error }: { error: string | null }) {
  const { t } = useT();
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {t(error)}
    </p>
  );
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
}
