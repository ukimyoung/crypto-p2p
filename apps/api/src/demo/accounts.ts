/**
 * Fixed demo accounts for trying the app locally. The password and operator OTP secrets are public
 * on purpose: never run the demo seed against a real database.
 */
export const DEMO_PASSWORD = 'demo password 1';

export const DEMO_USERS = [
  { email: 'seller@demo.test', nickname: '코인상점', legalName: '김판매', firstName: '판매', lastName: '김', phone: '+821011112222' },
  { email: 'buyer@demo.test', nickname: '비트모으미', legalName: '이구매', firstName: '구매', lastName: '이', phone: '+821033334444' },
] as const;

/**
 * Members with nothing in them yet (no balance, ads or orders) but past KYC, so they can
 * trade right away. Added on every start when missing, also to a demo database seeded earlier.
 */
export const DEMO_TESTERS = [
  { email: 'tester1@demo.test', nickname: '테스터1', legalName: '박테스트', firstName: '테스트', lastName: '박', phone: '+821055550001' },
  { email: 'tester2@demo.test', nickname: '테스터2', legalName: '최테스트', firstName: '테스트', lastName: '최', phone: '+821055550002' },
] as const;

/** The first one is the administrator, who also manages operator accounts. */
export const DEMO_OPERATORS = [
  { email: 'reviewer1@demo.test', name: '김심사', role: 'administrator', otpSecret: 'DEMOREVIEWERONEDEMOREVIEWERONE22' },
  { email: 'reviewer2@demo.test', name: '박심사', role: 'reviewer', otpSecret: 'DEMOREVIEWERTWODEMOREVIEWERTWO22' },
] as const;
