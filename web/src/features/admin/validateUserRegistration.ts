/**
 * @author Jemilin Beulah
 */
import type { UserRegisterRequest } from "@/api/admin";

export type FieldErrors = Record<string, string>;

const USERNAME_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
/** Deliberately permissive — real validation is Cognito accepting or rejecting the address
 * (Jakarta's @Email on the backend, and ultimately Cognito's own rules), not this regex.
 * Just enough to catch "forgot the @" before a submit round trip. */
const EMAIL_SHAPE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Mirrors CognitoUserProvisioningService.PASSWORD_POLICY: 12+ chars, at least one upper,
 * one lower, one digit, one non-alphanumeric. */
const PASSWORD_POLICY_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
const MAX_USERNAME_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;

/** Which identity field the form is currently collecting — see RegisterUserForm's toggle. */
export type RegistrationMode = "email" | "cognitoSub";

function validateEmailIdentity(draft: Partial<UserRegisterRequest>, errors: FieldErrors): void {
  if (!draft.email || draft.email.trim() === "") {
    errors.email = "Enter an email address to invite.";
  } else if (draft.email.length > MAX_EMAIL_LENGTH) {
    errors.email = `Keep the email to ${MAX_EMAIL_LENGTH} characters or fewer.`;
  } else if (!EMAIL_SHAPE_PATTERN.test(draft.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!draft.password) {
    errors.password = "Set a password for this account.";
  } else if (!PASSWORD_POLICY_PATTERN.test(draft.password)) {
    errors.password = "12+ characters, with upper, lower, a number, and a symbol.";
  }
}

function validateCognitoSubIdentity(draft: Partial<UserRegisterRequest>, errors: FieldErrors): void {
  // No email to derive a username from on this path, so it's asked for directly.
  if (!draft.username || draft.username.trim() === "") {
    errors.username = "Enter a username.";
  } else if (draft.username.length > MAX_USERNAME_LENGTH) {
    errors.username = `Keep the username to ${MAX_USERNAME_LENGTH} characters or fewer.`;
  } else if (!USERNAME_PATTERN.test(draft.username)) {
    errors.username = "Lowercase letters, numbers, and single . _ - separators only.";
  }

  if (!draft.cognitoSub || draft.cognitoSub.trim() === "") {
    errors.cognitoSub = "Enter the Cognito sub for this identity.";
  }
}

function validateCommonFields(draft: Partial<UserRegisterRequest>, errors: FieldErrors): void {
  if (!draft.displayName || draft.displayName.trim() === "") {
    errors.displayName = "Enter a display name.";
  } else if (draft.displayName.length > MAX_NAME_LENGTH) {
    errors.displayName = `Keep the display name to ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  if (!draft.role) {
    errors.role = "Choose a role.";
  }
}

/**
 * Mirrors AdminUserController.UserRegisterRequest's validation client-side. Only the active
 * mode's field is checked — the inactive one isn't sent at all (UserAdminService.register
 * requires exactly one).
 */
export function validateUserRegistration(draft: Partial<UserRegisterRequest>, mode: RegistrationMode): FieldErrors {
  const errors: FieldErrors = {};

  if (mode === "email") {
    validateEmailIdentity(draft, errors);
  } else {
    validateCognitoSubIdentity(draft, errors);
  }
  validateCommonFields(draft, errors);

  return errors;
}
