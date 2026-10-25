'use client';

import { useT } from '@/lib/i18n';

/** Same rule as the API: 2–16 Korean or Latin letters, digits or underscores. */
export const NICKNAME_PATTERN = '[0-9A-Za-z_\\uAC00-\\uD7A3]{2,16}';

export function NicknameInput({ value, onChange, id = 'nickname' }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { t } = useT();
  return (
    <>
      <label htmlFor={id}>{t('닉네임')}</label>
      <input
        id={id}
        autoComplete="nickname"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        pattern={NICKNAME_PATTERN}
        title={t('2~16자 한글, 영문, 숫자, 밑줄(_)')}
        maxLength={16}
        required
      />
      <p className="muted small-text" style={{ margin: '6px 0 0' }}>
        {t('마켓에서 다른 회원에게 보이는 이름입니다. 2~16자 한글, 영문, 숫자, 밑줄(_)을 쓸 수 있습니다.')}
      </p>
    </>
  );
}
