'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { describe } from '@/lib/notifications';
import type { Notification } from '@/lib/types';
import { useMe } from '@/lib/use-me';

export default function NotificationsPage() {
  const { me } = useMe();
  const { t, locale, date } = useT();
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const res = await api<{ notifications: Notification[] }>('notifications');
      setItems(res.notifications);
      // Opening the list counts as reading everything on it.
      if (res.notifications[0] && !res.notifications[0].readAt) {
        await api('notifications/read', { body: { upToId: res.notifications[0].id } });
        window.dispatchEvent(new Event('notifications-read'));
      }
    })();
  }, [me]);

  if (me === null) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return null;
  }
  if (!items) return <p className="muted">{t('불러오는 중…')}</p>;

  return (
    <>
      <h1>{t('알림')}</h1>
      <section className="card">
        {items.length === 0 && <p className="muted">{t('알림이 없습니다.')}</p>}
        <ul className="notifications">
          {items.map((n) => {
            const { text, href } = describe(n, locale);
            return (
              <li key={n.id} className={n.readAt ? '' : 'unread'}>
                {href ? <Link href={href}>{text}</Link> : text}
                <div className="muted small-text">{date(n.createdAt)}</div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
