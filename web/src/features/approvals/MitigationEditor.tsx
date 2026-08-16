/** @author Tang Chee Seng (with assistance from Claude) */
import { useState } from "react";
import type { MitigationSuggestion } from "@/api/approvals";

/**
 * A row carrying a stable client-side key.
 *
 * MitigationSuggestion has no id, so React rows cannot be keyed by any server field.
 * crypto.randomUUID() gives each row an identity that survives edits, adds and removals.
 */
interface EditableRow {
  key: string;
  value: MitigationSuggestion;
}

// Only the four always-present string fields are editable here; keeping the union narrow means
// the computed-property write below stays type-safe.
type EditableField = "priority" | "action" | "rationale" | "estimatedImpact";

function toRows(mitigations: readonly MitigationSuggestion[]): EditableRow[] {
  return mitigations.map((value) => ({ key: crypto.randomUUID(), value }));
}

function blankRow(): EditableRow {
  return {
    key: crypto.randomUUID(),
    value: { priority: "ADVISORY", action: "", rationale: "", estimatedImpact: "" },
  };
}

export function MitigationEditor({
  initial,
  onChange,
}: Readonly<{
  initial: readonly MitigationSuggestion[];
  onChange: (plan: MitigationSuggestion[]) => void;
}>) {
  // Lazy initialiser: the UUIDs are minted once on mount, not on every render.
  const [rows, setRows] = useState<EditableRow[]>(() => toRows(initial));

  function commit(next: EditableRow[]) {
    setRows(next);
    onChange(next.map((row) => row.value));
  }

  function editField(key: string, field: EditableField, fieldValue: string) {
    commit(rows.map((row) => (row.key === key ? { key, value: { ...row.value, [field]: fieldValue } } : row)));
  }

  return (
    <div className="mitigation-editor">
      <table className="mitigation-editor__table">
        <thead>
          <tr>
            <th>Priority</th><th>Action</th><th>Rationale</th><th>Impact</th>
            <th><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {/* Keyed by the row's own UUID. */}
          {rows.map((row) => (
            <tr key={row.key}>
              <td><input aria-label="Priority" value={row.value.priority}
                onChange={(e) => editField(row.key, "priority", e.target.value)} /></td>
              <td><input aria-label="Action" value={row.value.action}
                onChange={(e) => editField(row.key, "action", e.target.value)} /></td>
              <td><input aria-label="Rationale" value={row.value.rationale}
                onChange={(e) => editField(row.key, "rationale", e.target.value)} /></td>
              <td><input aria-label="Impact" value={row.value.estimatedImpact}
                onChange={(e) => editField(row.key, "estimatedImpact", e.target.value)} /></td>
              <td><button type="button" onClick={() => commit(rows.filter((r) => r.key !== row.key))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="mitigation-editor__add" onClick={() => commit([...rows, blankRow()])}>
        Add Mitigation
      </button>
    </div>
  );
}