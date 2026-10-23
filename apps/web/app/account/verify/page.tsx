'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { KycStatus } from '@/lib/types';
import { useMe } from '@/lib/use-me';

const SDK_URL = 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js';

interface SnsBuilder {
  withConf(conf: Record<string, unknown>): SnsBuilder;
  withOptions(opts: Record<string, unknown>): SnsBuilder;
  on(event: string, handler: (payload: unknown) => void): SnsBuilder;
  build(): { launch(selector: string): void };
}

declare global {
  interface Window {
    snsWebSdk?: { init(token: string, refresh: () => Promise<string>): SnsBuilder };
  }
}

/** Loads Sumsub's WebSDK once. */
function loadSdk(): Promise<void> {
  if (window.snsWebSdk) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('본인 인증 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    document.head.appendChild(script);
  });
}

/** Identity verification (KYC-1): Sumsub's WebSDK with a token the server creates. */
export default function VerifyPage() {
  const { me, reload } = useMe();
  const { t, locale } = useT();
  const [status, setStatus] = useState<KycStatus | null>(null);
  const [launched, setLaunched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<KycStatus>('kyc'));
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  const finalReject =
    status?.applicant?.reviewStatus === 'completed' &&
    status.applicant.reviewAnswer === 'RED' &&
    status.applicant.rejectType === 'FINAL';
  const canStart = status !== null && status.available && status.kycLevel === 0 && !finalReject;

  useEffect(() => {
    if (!canStart || started.current) return;
    started.current = true;
    (async () => {
      try {
        const { token } = await api<{ token: string }>('kyc/token', { method: 'POST' });
        await loadSdk();
        const refresh = async () => (await api<{ token: string }>('kyc/token', { method: 'POST' })).token;
        window
          .snsWebSdk!.init(token, refresh)
          .withConf({ lang: locale })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .on('idCheck.onApplicantSubmitted', () => setSubmitted(true))
          .on('idCheck.onApplicantResubmitted', () => setSubmitted(true))
          .on('idCheck.onApplicantStatusChanged', () => {
            void load();
            void reload();
          })
          .build()
          .launch('#sumsub-websdk-container');
        setLaunched(true);
      } catch (err) {
        started.current = false;
        setError(messageOf(err));
      }
    })();
  }, [canStart, locale, load, reload]);

  if (me === undefined) return <p className="muted">{t('불러오는 중…')}</p>;
  if (me === null) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return null;
  }

  return (
    <>
      <h1>{t('본인 인증')}</h1>
      <p className="muted">
        {t(
          '신분증과 얼굴 사진으로 본인임을 확인합니다. 인증은 Sumsub가 처리하고, 신분증 이미지는 이 서비스에 저장하지 않습니다.',
        )}
      </p>
      {status && !status.available && <p className="notice">{t('본인 인증을 아직 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.')}</p>}
      {status && status.kycLevel >= 1 && (
        <p className="notice">
          {t('본인 인증이 완료되었습니다.')} <Link href="/account">{t('내 계정으로 가기')}</Link>
        </p>
      )}
      {finalReject && (
        <p className="error" role="alert">
          {t('본인 인증이 최종 거절되었습니다. 자세한 내용은 고객센터에 문의해 주세요.')}
        </p>
      )}
      {status?.applicant?.reviewAnswer === 'RED' && status.applicant.rejectType === 'RETRY' && (
        <p className="notice">
          {t('지난 제출이 승인되지 않았습니다. 안내에 따라 다시 제출해 주세요.')}
          {status.applicant.moderationComment && (
            <>
              <br />
              {status.applicant.moderationComment}
            </>
          )}
        </p>
      )}
      {submitted && <p className="notice">{t('제출되었습니다. 심사 결과는 알림으로 알려 드립니다.')}</p>}
      {canStart && !launched && !error && <p className="muted">{t('본인 인증 화면을 불러오는 중…')}</p>}
      <div id="sumsub-websdk-container" />
      <ErrorText error={error} />
    </>
  );
}
