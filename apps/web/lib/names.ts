// Masked names in the operations console keep their letters' script around the asterisks.
const HANGUL = /^[\p{Script=Hangul}*\s]+$/u;

/** Hong Gildong as "Gildong Hong", 홍 길동 as "홍길동" (family name first, no space). Null when neither part is set. */
export function fullName(firstName: string | null, lastName: string | null): string | null {
  if (!firstName && !lastName) return null;
  if (firstName && lastName && HANGUL.test(firstName + lastName)) return lastName + firstName;
  return [firstName, lastName].filter(Boolean).join(' ');
}
