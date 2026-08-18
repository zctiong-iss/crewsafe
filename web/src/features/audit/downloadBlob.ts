/** @author Tang Chee Seng (with assistance from Claude) */
/**
 * Triggers a browser "save file" for an already-fetched Blob. Isolated from the component so the
 * temporary object-URL lifecycle (create -> click -> revoke) lives in one tested place, and the
 * page never touches the DOM directly.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick, not synchronously: some browsers cancel an in-flight download if
  // the URL is revoked in the same frame as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
