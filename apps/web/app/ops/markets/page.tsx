'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { ASSET_STATUS, MARKET_STATUS } from '@/lib/ops-labels';
import type { MarketsOverview } from '@/lib/types';
import { isAdmin } from '@/lib/use-operator';
import { useCurrentOperator } from '../OpsShell';

export default function OpsMarketsPage() {
  const operator = useCurrentOperator();
  const admin = isAdmin(operator);
  const [data, setData] = useState<MarketsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api<MarketsOverview>('ops/markets'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(path: string, label: string, status: string, statusLabel: string) {
    const reason = window.prompt(`${label}을(를) '${statusLabel}'(으)로 바꿉니다. 사유를 적어 주세요.`);
    if (!reason?.trim()) {
      await load(); // put the select back
      return;
    }
    setError(null);
    try {
      await api(path, { method: 'PUT', body: { status, reason } });
    } catch (err) {
      setError(messageOf(err));
    }
    await load();
  }

  if (!data) return <p className="muted">불러오는 중…</p>;

  return (
    <>
      <h1>마켓</h1>
      <p className="muted small-text">
        {admin
          ? '상태 변경은 관리자만 할 수 있고, 사유와 함께 감사 로그에 남습니다. 진행 중인 주문과 출금은 그대로 처리됩니다.'
          : '상태 변경은 관리자만 할 수 있습니다.'}
      </p>
      <ErrorText error={error} />
      <section className="card">
        <h2>마켓 (코인 × 법정화폐)</h2>
        <p className="muted small-text">일시 중지와 닫힘은 새 광고와 새 주문을 막고, 마켓 목록에서 광고를 숨깁니다.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>마켓</th>
                <th>상태</th>
                <th>노출 광고</th>
                <th>진행 중 주문</th>
                <th>바뀐 시각</th>
              </tr>
            </thead>
            <tbody>
              {data.markets.map((m) => (
                <tr key={`${m.asset}/${m.fiat}`}>
                  <td>
                    {m.asset}/{m.fiat}
                  </td>
                  <td>
                    {admin ? (
                      <select
                        aria-label={`${m.asset}/${m.fiat} 상태`}
                        value={m.status}
                        style={{ width: 'auto' }}
                        onChange={(e) =>
                          change(`ops/markets/${m.asset}/${m.fiat}`, `${m.asset}/${m.fiat} 마켓`, e.target.value, MARKET_STATUS[e.target.value]!)
                        }
                      >
                        {Object.entries(MARKET_STATUS).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ) : (
                      MARKET_STATUS[m.status]
                    )}
                  </td>
                  <td>{m.onlineAds}</td>
                  <td>{m.openOrders}</td>
                  <td className="muted">{new Date(m.updatedAt).toLocaleString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>코인</h2>
        <p className="muted small-text">
          신규 광고 중지는 새 광고만, 출금 중지는 새 출금 신청만 막습니다. 상장 폐지는 새 광고, 주문, 출금을 모두
          막습니다. 새 코인 추가는 커스터디와 주소 검사가 코드에 있어야 해서 이 화면에서는 하지 않습니다.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>코드</th>
                <th>네트워크</th>
                <th>소수점</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <tr key={a.code}>
                  <td>{a.code}</td>
                  <td>{a.network}</td>
                  <td>{a.decimals}</td>
                  <td>
                    {admin ? (
                      <select
                        aria-label={`${a.code} 상태`}
                        value={a.status}
                        style={{ width: 'auto' }}
                        onChange={(e) =>
                          change(`ops/markets/assets/${a.code}`, `${a.code} 코인`, e.target.value, ASSET_STATUS[e.target.value]!)
                        }
                      >
                        {Object.entries(ASSET_STATUS).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ASSET_STATUS[a.status]
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
