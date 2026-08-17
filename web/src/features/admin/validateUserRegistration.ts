/**
 * @author Jemilin Beulah
 */
import type { UserRegisterRequest } from "@/api/admin";

export type FieldErrors = Record<string, string>;

const USERNAME_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const MAX_USERNAME_LENGTH = 64;
const MAX_NAME_LENGTH = 120;

/**
 * Mirrors AdminUserController.UserRegisterRequest's validation client-side. This does not
 * create a Cognito identity — the cognitoSub field is pasted in from wherever the account was
 * actually created (AWS Console, or the SCRUM-190 CI pipeline for synthetic identities).
 */
export function validateUserRegistration(draft: Partial<UserRegisterRequest>): FieldErrors {
  const errors: FieldErrors = {};

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

  if (!draft.displayName || draft.displayName.trim() === "") {
    errors.displayName = "Enter a display name.";
  } else if (draft.displayName.length > MAX_NAME_LENGTH) {
    errors.displayName = `Keep the display name to ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  if (!draft.role) {
    errors.role = "Choose a role.";
  }

  return errors;
}
