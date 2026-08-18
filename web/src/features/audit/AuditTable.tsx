/** @author Tang Chee Seng (with assistance from Claude) */
import type { AuditPage as AuditPageData } from "@/api/audit";

export function AuditTable({
  data,
  page,
  onPage,
}: Readonly<{ data: AuditPageData; page: number; onPage: (next: number) => void }>) {
  const lastPage = Math.max(0, Math.ceil(data.totalEntries / data.pageSize) - 1);

  return (
    <>
      <table className="audit-table">
        <caption className="visually-hidden">
          Audit timeline for this site, {data.totalEntries} events; showing page {page + 1}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Actor</th>
            <th scope="col">Event</th>
            <th scope="col">Target</th>
            <th scope="col">Trace ID</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((entry) => (
            // Key by correlationId + occurredAt: two rows can share a trace id (dispatch + ack),
            // so neither alone is unique — the pair is. Never the array index (S6479).
            <tr key={`${entry.correlationId}:${entry.occurredAt}`}>
              <td>{new Date(entry.occurredAt).toLocaleString()}</td>
              <td>{entry.actorName}</td>
              <td>
                {entry.eventLabel}
                {entry.detail && <span className="audit-table__detail"> — {entry.detail}</span>}
              </td>
              <td>
                <span className="code">{entry.targetType}</span>
              </td>
              <td>
                <span className="code">{entry.correlationId}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.totalEntries > data.pageSize && (
        <nav className="audit__pager" aria-label="Audit pages">
          <button
            type="button"
            className="audit__pager-button"
            onClick={() => onPage(page - 1)}
            disabled={page === 0}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {lastPage + 1}
          </span>
          <button
            type="button"
            className="audit__pager-button"
            onClick={() => onPage(page + 1)}
            disabled={page >= lastPage}
          >
            Next
          </button>
        </nav>
      )}
    </>
  );
}
