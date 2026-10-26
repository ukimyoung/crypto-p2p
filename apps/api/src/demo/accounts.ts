/**
 * Fixed demo accounts for trying the app locally. The password and operator OTP secrets are public
 * on purpose: never run the demo seed against a real database.
 */
export const DEMO_PASSWORD = 'demo password 1';

export const DEMO_USERS = [
  { email: 'seller@demo.test', nickname: '코인상점', legalName: '김판매', firstName: '판매', lastName: '김', phone: '+821011112222' },
  { email: 'buyer@demo.test', nickname: '비트모으미', legalName: '이구매', firstName: '구매', lastName: '이', phone: '+821033334444' },
] as const;

export interface DemoTester {
  email: string;
  nickname: string;
  legalName: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** Defaults to DEMO_PASSWORD. */
  password?: string;
  /** Starting balance in the smallest unit (satoshi, micro-USDT). */
  btc?: bigint;
  usdt?: bigint;
  /** A KRW account in the member's legal name, usable at once. */
  bank?: { bankCode: string; accountNumber: string };
}

/**
 * Members past KYC, so they can trade right away. tester1 and tester2 start empty (no balance,
 * ads or orders); the QA accounts start with a bank account, and seller2 with coins to sell.
 * Added on every start when missing, also to a demo database seeded earlier.
 */
export const DEMO_TESTERS: DemoTester[] = [
  { email: 'tester1@demo.test', nickname: '테스터1', legalName: '박테스트', firstName: '테스트', lastName: '박', phone: '+821055550001' },
  { email: 'tester2@demo.test', nickname: '테스터2', legalName: '최테스트', firstName: '테스트', lastName: '최', phone: '+821055550002' },
  {
    email: 'buyer2@demo.test',
    nickname: '순신77',
    legalName: '이순신',
    firstName: '순신',
    lastName: '이',
    phone: '+821055550003',
    password: 'test12!@',
    bank: { bankCode: '088', accountNumber: '110123456789' },
  },
  {
    email: 'seller2@demo.test',
    nickname: '기자77',
    legalName: '박기자',
    firstName: '기자',
    lastName: '박',
    phone: '+821055550004',
    password: 'test12!@',
    btc: 100_000_000n,
    usdt: 10_000_000_000n,
    bank: { bankCode: '004', accountNumber: '987654321098' },
  },
];

/** The first one is the administrator, who also manages operator accounts. */
export const DEMO_OPERATORS = [
  { email: 'reviewer1@demo.test', name: '김심사', role: 'administrator', otpSecret: 'DEMOREVIEWERONEDEMOREVIEWERONE22' },
  { email: 'reviewer2@demo.test', name: '박심사', role: 'reviewer', otpSecret: 'DEMOREVIEWERTWODEMOREVIEWERTWO22' },
] as const;
