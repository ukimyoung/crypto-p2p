import { DomainError } from '../common/errors';

/** Countries members can pick for their phone number, with the calling code. Keep in step with the web list. */
export const PHONE_COUNTRIES: Record<string, string> = {
  KR: '82',
  US: '1',
  CA: '1',
  JP: '81',
  CN: '86',
  HK: '852',
  TW: '886',
  SG: '65',
  VN: '84',
  TH: '66',
  PH: '63',
  ID: '62',
  MY: '60',
  IN: '91',
  MN: '976',
  UZ: '998',
  KZ: '7',
  RU: '7',
  AE: '971',
  TR: '90',
  AU: '61',
  NZ: '64',
  GB: '44',
  DE: '49',
  FR: '33',
  IT: '39',
  ES: '34',
  NL: '31',
  BR: '55',
  MX: '52',
};

/** Countries whose numbers are dialed at home with a leading 0 that the international form drops. */
const TRUNK_ZERO = new Set(['KR', 'JP', 'CN', 'TW', 'VN', 'TH', 'PH', 'ID', 'MY', 'IN', 'AE', 'TR', 'AU', 'NZ', 'GB', 'DE', 'FR', 'NL', 'BR']);

export interface Phone {
  country: string;
  /** E.164, such as +821012345678. */
  e164: string;
}

/** Turns a picked country and a number typed the local way (010-1234-5678) into E.164. */
export function normalizePhone(country: string, number: string): Phone {
  const dial = PHONE_COUNTRIES[country];
  if (!dial) throw new DomainError('invalid_phone', 'Pick a country for the phone number');
  if (!/^[\d\s\-().]+$/.test(number.trim())) {
    throw new DomainError('invalid_phone', 'Phone number may only contain digits');
  }
  let national = number.replace(/\D/g, '');
  if (TRUNK_ZERO.has(country)) national = national.replace(/^0/, '');
  if (national.length < 6 || dial.length + national.length > 15 || (country === 'KR' && !/^\d{8,10}$/.test(national))) {
    throw new DomainError('invalid_phone', 'Phone number is not valid');
  }
  return { country, e164: `+${dial}${national}` };
}

/** +821012345678 -> +82 10-1234-5678. Numbers saved before country codes are shown as they are. */
export function formatPhone(e164: string | null, country: string | null): string | null {
  if (!e164) return null;
  const dial = country ? PHONE_COUNTRIES[country] : undefined;
  if (!dial || !e164.startsWith(`+${dial}`)) return e164;
  const national = e164.slice(dial.length + 1);
  if (country === 'KR') {
    const m = /^(1\d|2|[3-6]\d)(\d{3,4})(\d{4})$/.exec(national);
    if (m) return `+${dial} ${m[1]}-${m[2]}-${m[3]}`;
  }
  return `+${dial} ${national}`;
}

/** The number in the member's own local form (010-1234-5678 for Korea), for editing. */
export function nationalPhone(e164: string | null, country: string | null): string | null {
  const formatted = formatPhone(e164, country);
  if (!formatted || !country || formatted === e164) return formatted;
  const local = formatted.slice(formatted.indexOf(' ') + 1);
  return TRUNK_ZERO.has(country) ? `0${local}` : local;
}
