import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../common/errors';

export interface SumsubConfig {
  appToken: string;
  secretKey: string;
  webhookSecret: string;
  levelName: string;
  baseUrl: string;
}

/** The parts of a Sumsub applicant we keep. ID images and document numbers are left in Sumsub. */
export interface SumsubApplicant {
  id: string;
  externalUserId: string;
  levelName: string | null;
  reviewStatus: string;
  reviewAnswer: 'GREEN' | 'RED' | null;
  rejectType: 'RETRY' | 'FINAL' | null;
  rejectLabels: string[];
  moderationComment: string | null;
  clientComment: string | null;
  /** The name read from the ID document, Korean order for Hangul names. */
  legalName: string | null;
}

/** What the service needs from Sumsub. Tests swap in a fake. */
export interface SumsubApi {
  readonly levelName: string;
  /** A WebSDK token for the member's applicant. Sumsub creates the applicant on first use. */
  accessToken(externalUserId: string): Promise<string>;
  /** The member's applicant, or null when there is none yet. */
  applicantByExternalId(externalUserId: string): Promise<SumsubApplicant | null>;
  /** Asks Sumsub to check the applicant again (KYC-5). */
  requestCheck(applicantId: string): Promise<void>;
  /** True when `digest` is Sumsub's signature of `body`. */
  verifyWebhook(body: Buffer, digest: string | undefined, alg: string | undefined): boolean;
}

/** Reads the Sumsub keys. They live only in the environment (KYC-6); null when they are not set. */
export function loadSumsubConfig(env: NodeJS.ProcessEnv = process.env): SumsubConfig | null {
  const appToken = env.SUMSUB_APP_TOKEN;
  const secretKey = env.SUMSUB_SECRET_KEY;
  const webhookSecret = env.SUMSUB_WEBHOOK_SECRET;
  const levelName = env.SUMSUB_LEVEL_NAME;
  if (!appToken || !secretKey || !webhookSecret || !levelName) return null;
  return { appToken, secretKey, webhookSecret, levelName, baseUrl: env.SUMSUB_BASE_URL ?? 'https://api.sumsub.com' };
}

const DIGEST_ALGS: Record<string, string> = {
  HMAC_SHA1_HEX: 'sha1',
  HMAC_SHA256_HEX: 'sha256',
  HMAC_SHA512_HEX: 'sha512',
};

/** HMAC check for a webhook body, as Sumsub signs it with the webhook secret. */
export function verifySumsubDigest(
  secret: string,
  body: Buffer,
  digest: string | undefined,
  alg: string | undefined,
): boolean {
  const hash = DIGEST_ALGS[alg ?? 'HMAC_SHA256_HEX'];
  if (!hash || !digest) return false;
  const expected = createHmac(hash, secret).update(body).digest();
  const given = Buffer.from(digest, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Sumsub REST API with the app-token signature on every request. */
export class SumsubClient implements SumsubApi {
  constructor(
    private readonly config: SumsubConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get levelName(): string {
    return this.config.levelName;
  }

  async accessToken(externalUserId: string): Promise<string> {
    const res = await this.request<{ token: string }>('POST', '/resources/accessTokens/sdk', {
      userId: externalUserId,
      levelName: this.config.levelName,
      ttlInSecs: 1800,
    });
    return res!.token;
  }

  async applicantByExternalId(externalUserId: string): Promise<SumsubApplicant | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await this.request<any>(
      'GET',
      `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`,
      undefined,
      true,
    );
    return res ? toApplicant(res) : null;
  }

  async requestCheck(applicantId: string): Promise<void> {
    await this.request('POST', `/resources/applicants/${encodeURIComponent(applicantId)}/status/pending`);
  }

  verifyWebhook(body: Buffer, digest: string | undefined, alg: string | undefined): boolean {
    return verifySumsubDigest(this.config.webhookSecret, body, digest, alg);
  }

  private async request<T>(method: string, path: string, body?: unknown, allowMissing = false): Promise<T | null> {
    const text = body === undefined ? '' : JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac('sha256', this.config.secretKey).update(ts + method + path + text).digest('hex');
    let res: Response;
    try {
      res = await this.fetchFn(this.config.baseUrl + path, {
        method,
        headers: {
          Accept: 'application/json',
          ...(text ? { 'Content-Type': 'application/json' } : {}),
          'X-App-Token': this.config.appToken,
          'X-App-Access-Ts': ts,
          'X-App-Access-Sig': sig,
        },
        body: text || undefined,
      });
    } catch {
      throw new DomainError('kyc_provider_error', 'Could not reach the identity verification service');
    }
    if (allowMissing && res.status === 404) return null;
    if (!res.ok) {
      throw new DomainError('kyc_provider_error', `Identity verification service answered ${res.status}`);
    }
    const out = await res.text();
    return out ? (JSON.parse(out) as T) : null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toApplicant(a: any): SumsubApplicant {
  const result = a.review?.reviewResult ?? {};
  return {
    id: a.id,
    externalUserId: a.externalUserId,
    levelName: a.review?.levelName ?? a.levelName ?? null,
    reviewStatus: a.review?.reviewStatus ?? 'init',
    reviewAnswer: result.reviewAnswer ?? null,
    rejectType: result.reviewRejectType ?? null,
    rejectLabels: result.rejectLabels ?? [],
    moderationComment: result.moderationComment ?? null,
    clientComment: result.clientComment ?? null,
    legalName: legalNameOf(a.info ?? {}) ?? legalNameOf(a.fixedInfo ?? {}),
  };
}

/** "홍" + "길동" -> "홍길동"; "Jane" + "Doe" -> "Jane Doe". */
export function legalNameOf(info: { firstName?: string; lastName?: string; middleName?: string }): string | null {
  const first = info.firstName?.trim() ?? '';
  const last = info.lastName?.trim() ?? '';
  if (!first && !last) return null;
  if (/[가-힣]/.test(first + last)) return `${last}${first}`;
  return [first, info.middleName?.trim(), last].filter(Boolean).join(' ');
}
