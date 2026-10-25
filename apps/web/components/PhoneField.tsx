'use client';

import { useT } from '@/lib/i18n';
import { PHONE_COUNTRIES } from '@/lib/phone';

/** Country code picker and the number typed the local way (010-1234-5678). */
export function PhoneField({
  id,
  country,
  number,
  onCountry,
  onNumber,
}: {
  id: string;
  country: string;
  number: string;
  onCountry: (country: string) => void;
  onNumber: (number: string) => void;
}) {
  const { t } = useT();

  return (
    <>
      <label htmlFor={id}>{t('휴대폰 번호')}</label>
      <div className="phone-field">
        <select aria-label={t('국가 번호')} value={country} onChange={(e) => onCountry(e.target.value)} required>
          {PHONE_COUNTRIES.map(({ code, dial, name }) => (
            <option key={code} value={code}>
              {t(name)} (+{dial})
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          autoComplete="tel-national"
          inputMode="tel"
          placeholder={country === 'KR' ? '010-1234-5678' : undefined}
          value={number}
          onChange={(e) => onNumber(e.target.value)}
          required
        />
      </div>
    </>
  );
}
