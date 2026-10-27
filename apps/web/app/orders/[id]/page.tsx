'use client';

import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ErrorText, messageOf } from '@/components/ErrorText';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BANKS, ORDER_STATUS } from '@/lib/messages';
import { fullName } from '@/lib/names';
import type { Me, Message, Order, PaymentDetails } from '@/lib/types';
import { ASSETS, AssetCode, formatKrw, formatRate, formatUnits } from '@/lib/units';
import { useMe } from '@/lib/use-me';

const POLL_MS = 3000;

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const { t, locale } = useT();
  const [order, setOrder] = useState<Order | null>(null);
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ order: Order; paymentDetails: PaymentDetails | null }>(`orders/${id}`);
      setOrder(res.order);
      setDetails(res.paymentDetails);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (error && !order) return <ErrorText error={error} />;
  if (!order || !me) return <p className="muted">{t('불러오는 중…')}</p>;

  const isBuyer = order.buyerId === me.id;
  const decimals = ASSETS[order.asset as AssetCode].decimals;
  // The buyer pays from an account in their own name, so the transfer shows the name they signed up with.
  const senderName = fullName(me.firstName, me.lastName);

  return (
    <>
      <h1>
        {t(isBuyer ? '{asset} 구매 주문' : '{asset} 판매 주문', { asset: order.asset })}{' '}
        <span className={`badge ${order.status}`}>{t(ORDER_STATUS[order.status] ?? order.status)}</span>
      </h1>
      <Guide order={order} isBuyer={isBuyer} />
      <section className="card">
        <dl className="kv">
          <dt>{t('수량')}</dt>
          <dd>
            {formatUnits(order.amount, decimals)} {order.asset}
          </dd>
          <dt>{t(isBuyer ? '보낼 금액' : '받을 금액')}</dt>
          <dd className="price">{formatKrw(order.fiatAmountMinor, locale)}</dd>
          <dt>{t('가격')}</dt>
          <dd>
            1 {order.asset} = {formatKrw(order.priceMinor, locale)}
            {order.feeRateBp > 0 && (
              <span className="muted small-text">
                {' '}
                ({t('수수료 {rate} 포함', { rate: formatRate(order.feeRateBp) })})
              </span>
            )}
          </dd>
          {order.makerId === me.id && BigInt(order.feeFiatMinor) > 0n && (
            <>
              <dt>{t('광고 수수료')}</dt>
              <dd>
                {formatKrw(order.feeFiatMinor, locale)}{' '}
                <span className="muted small-text">{t('거래가 완료되면 수수료 청구서에 포함됩니다.')}</span>
              </dd>
            </>
          )}
          {order.status === 'pending_payment' && (
            <>
              <dt>{t('결제 기한')}</dt>
              <dd>
                <Countdown deadline={order.paymentDeadline} />
              </dd>
            </>
          )}
          {details && (
            <>
              <dt>{t('입금 계좌')}</dt>
              <dd>
                <strong>
                  {t(BANKS[details.bankCode] ?? details.bankCode)} {details.accountNumber}
                </strong>
                <br />
                {t('예금주 {name}', { name: details.accountHolder })}
              </dd>
            </>
          )}
          {details && isBuyer && senderName && (
            <>
              <dt>{t('보내는 사람')}</dt>
              <dd>{senderName}</dd>
            </>
          )}
          <dt>{t('주문 번호')}</dt>
          <dd>{order.orderNumber}</dd>
        </dl>
        <Actions order={order} isBuyer={isBuyer} onChange={load} />
      </section>
      <Chat orderId={order.id} me={me} />
    </>
  );
}

function Guide({ order, isBuyer }: { order: Order; isBuyer: boolean }) {
  const { t } = useT();
  const text: Record<string, [string, string]> = {
    pending_payment: [
      '아래 계좌로 정확한 금액을 본인 명의 계좌에서 이체한 뒤 "이체 완료"를 눌러 주세요. 판매자의 코인은 에스크로에 잠겨 있습니다.',
      '구매자의 이체를 기다리고 있습니다. 코인은 에스크로에 잠겨 있습니다. 입금을 계좌에서 확인하기 전에는 절대 코인을 넘기지 마세요.',
    ],
    paid: [
      '판매자가 입금을 확인하면 코인이 내 지갑으로 들어옵니다. 판매자가 정해진 시간 안에 응답하지 않으면 주문이 자동으로 운영 검토로 넘어가고, 그 전에 직접 요청할 수도 있습니다.',
      '구매자가 이체했다고 표시했습니다. 은행 앱에서 입금자명과 금액을 직접 확인한 뒤 코인을 넘겨 주세요. 캡처 화면만 믿지 마세요.',
    ],
    under_review: ['운영팀이 확인하고 있습니다. 채팅에 증빙을 남겨 주세요.', '운영팀이 확인하고 있습니다. 채팅에 증빙을 남겨 주세요.'],
    completed: ['거래가 끝났습니다. 코인이 내 지갑에 들어왔습니다.', '거래가 끝났습니다.'],
    cancelled: ['주문이 취소되었습니다.', '주문이 취소되었고 코인은 내 지갑으로 돌아왔습니다.'],
  };
  const [buyerText, sellerText] = text[order.status] ?? ['', ''];
  return <p className="notice">{t(isBuyer ? buyerText : sellerText)}</p>;
}

function Countdown({ deadline }: { deadline: string }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, new Date(deadline).getTime() - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <span>{left > 0 ? t('{m}분 {s}초 남음', { m, s: String(s).padStart(2, '0') }) : t('기한 지남')}</span>;
}

function Actions({ order, isBuyer, onChange }: { order: Order; isBuyer: boolean; onChange: () => Promise<void> }) {
  const { t, locale } = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(path: string, confirmText: string, body?: unknown) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`orders/${order.id}/${path}`, { method: 'POST', body });
      await onChange();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const s = order.status;
  return (
    <div style={{ marginTop: 20 }}>
      {isBuyer && s === 'pending_payment' && (
        <div className="row">
          <button
            disabled={busy}
            onClick={() => act('paid', t('판매자 계좌로 이체를 마치셨나요? 이체하지 않고 누르면 제재될 수 있습니다.'))}
          >
            {t('이체 완료')}
          </button>
          <button className="secondary" disabled={busy} onClick={() => act('cancel', t('주문을 취소할까요?'))}>
            {t('주문 취소')}
          </button>
        </div>
      )}
      {!isBuyer && (s === 'pending_payment' || s === 'paid') && (
        <div>
          <button
            disabled={busy}
            onClick={() =>
              act(
                'release',
                t('계좌에 {amount}이 들어온 것을 직접 확인하셨나요? 코인을 넘기면 되돌릴 수 없습니다.', {
                  amount: formatKrw(order.fiatAmountMinor, locale),
                }),
              )
            }
          >
            {t('입금 확인, 코인 넘기기')}
          </button>
        </div>
      )}
      {s === 'paid' && (
        <button
          className="secondary small"
          style={{ marginTop: 12 }}
          disabled={busy}
          onClick={() => act('escalate', t('운영팀에 검토를 요청할까요? 채팅에 증빙을 남겨 주세요.'))}
        >
          {t('문제가 있어요 (운영 검토 요청)')}
        </button>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function Chat({ orderId, me }: { orderId: string; me: Me }) {
  const { t } = useT();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef('0');
  const box = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    const res = await api<{ messages: Message[] }>(`orders/${orderId}/messages?after=${lastId.current}`);
    if (res.messages.length) {
      lastId.current = res.messages.at(-1)!.id;
      setMessages((prev) => [...prev, ...res.messages]);
    }
  }, [orderId]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      await api(`orders/${orderId}/messages`, { body: { body: text } });
      setText('');
      await poll();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <section className="card">
      <h2>{t('채팅')}</h2>
      <p className="muted small-text">
        {t('채팅은 지울 수 없고 분쟁 시 증빙으로 쓰입니다. 플랫폼 밖 연락처 교환은 피해 주세요.')}
      </p>
      <div className="chat" ref={box}>
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === me.id ? 'mine' : ''}`}>
            {m.body}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('메시지 입력')} maxLength={1000} style={{ flex: 1 }} />
        <button>{t('보내기')}</button>
      </form>
      <ErrorText error={error} />
    </section>
  );
}
