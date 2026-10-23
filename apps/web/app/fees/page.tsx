'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { INVOICE_STATUS } from '@/lib/messages';
import type { FeeInvoice } from '@/lib/types';
import { formatKrw, kstDate } from '@/lib/units';
import { useMe } from '@/lib/use-me';

export default function FeesPage() {
  const { me } = useMe();
  const { t, locale } = useT();
  const [data, setData] = useState<{ invoices: FeeInvoice[]; unbilled: { fiat: string; amountMinor: string }[] } | null>(
    null,
  );

  useEffect(() => {
    if (me) void api<typeof data>('fees/invoices').then(setData);
  }, [me]);

  if (me === null) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return null;
  }
  if (!data) return <p className="muted">{t('불러오는 중…')}</p>;

  const overdue = data.invoices.some((i) => i.status === 'overdue');
  const unbilled = data.unbilled.find((u) => u.fiat === 'KRW')?.amountMinor ?? '0';

  return (
    <>
      <h1>{t('수수료 청구')}</h1>
      <p className="muted">
        {t(
          '광고 수수료는 거래 가격에 포함되어 구매자가 함께 이체하고, 거래가 끝난 뒤 청구 주기마다 원화로 청구됩니다. 납부 기한이 지나면 완납할 때까지 광고가 노출되지 않습니다.',
        )}
      </p>
      {overdue && (
        <p className="error" role="alert">
          {t('연체된 수수료가 있어 광고가 노출되지 않고 새 광고를 올릴 수 없습니다. 납부 후 고객센터에 알려 주세요.')}
        </p>
      )}
      <section className="card">
        <dl className="kv">
          <dt>{t('아직 청구되지 않은 수수료')}</dt>
          <dd>{formatKrw(unbilled, locale)}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>{t('청구서')}</h2>
        {data.invoices.length === 0 ? (
          <p className="muted">{t('청구서가 없습니다.')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('기간')}</th>
                  <th>{t('청구 금액')}</th>
                  <th>{t('납부한 금액')}</th>
                  <th>{t('납부 기한')}</th>
                  <th>{t('상태')}</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {kstDate(i.periodStart)} ~ {kstDate(i.periodEnd, true)}
                    </td>
                    <td>{formatKrw(i.totalMinor, locale)}</td>
                    <td>{formatKrw(i.paidMinor, locale)}</td>
                    <td>{kstDate(i.dueAt, true)}</td>
                    <td>
                      <span className={`badge invoice-${i.status}`}>{t(INVOICE_STATUS[i.status] ?? i.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
