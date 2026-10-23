import type { AuditEntry } from '@/lib/types';

/** Audit log rows. Operator ids are shown by name when known. */
export function AuditTable({ entries, names }: { entries: AuditEntry[]; names: Record<string, string> }) {
  if (entries.length === 0) return <p className="muted">기록이 없습니다.</p>;
  const actor = (e: AuditEntry) => {
    if (e.actorType === 'system') return '시스템';
    if (e.actorType === 'operator') return `운영자 ${names[e.actorId!] ?? e.actorId?.slice(0, 8)}`;
    return `회원 ${e.actorId?.slice(0, 8)}`;
  };
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>시각</th>
            <th>행위자</th>
            <th>동작</th>
            <th>대상</th>
            <th>내용</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.createdAt).toLocaleString('ko-KR')}</td>
              <td>{actor(e)}</td>
              <td>
                <code>{e.action}</code>
              </td>
              <td>
                {e.targetType} {e.targetId.slice(0, 8)}
              </td>
              <td>
                {/* Settings changes show the old values too, so the change can be read in one place. */}
                {e.action.startsWith('settings.') && e.before ? (
                  <>
                    <div className="muted small-text">변경 전</div>
                    <pre className="json">{JSON.stringify(e.before, null, 1)}</pre>
                    <div className="muted small-text">변경 후</div>
                  </>
                ) : null}
                {e.after ? <pre className="json">{JSON.stringify(e.after, null, 1)}</pre> : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
