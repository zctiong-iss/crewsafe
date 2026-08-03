/**
 * A sign-in failure, carrying a translation key rather than a message.
 *
 * Cognito's own error strings are English-only and written for developers ("Incorrect
 * username or password."). Showing them to a worker would break the rule that every
 * message in this app is translatable, so the mapping from Cognito's `__type` to something
 * a person can read happens once, in `cognitoPasswordAuth.ts`, and travels as a key.
 */
export class AuthError extends Error {
  /** An i18n key, e.g. "auth.cognito.invalidCredentials". */
  readonly messageKey: string;
  /** Interpolation values for that key, if it takes any. */
  readonly messageParams: Record<string, string>;

  constructor(messageKey: string, messageParams: Record<string, string> = {}) {
    super(messageKey);
    this.name = "AuthError";
    this.messageKey = messageKey;
    this.messageParams = messageParams;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}
