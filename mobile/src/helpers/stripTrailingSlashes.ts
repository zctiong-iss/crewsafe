/** Removes every slash at the end of a URL-like string without touching internal slashes. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === "/") end -= 1;
  return value.slice(0, end);
}
