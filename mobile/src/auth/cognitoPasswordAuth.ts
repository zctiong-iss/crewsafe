/**
 * `cognito-password` mode: real Cognito tokens inside Expo Go.
 *
 * Cognito's `InitiateAuth` with `USER_PASSWORD_AUTH` is an unauthenticated API — no AWS
 * credentials, no SigV4 signing, no SDK. It is a single JSON POST, which is why this file
 * is short and why it needs nothing added to the dependency tree.
 *
 * It works on a phone because it involves no browser and therefore no redirect URI. That
 * is the whole reason this mode exists: the mobile app client's callback is pinned by
 * Terraform to `crewsafe://callback`, a scheme only a native build can register, so Expo Go
 * cannot complete the Hosted UI flow at all.
 *
 * It targets the `crewsafe-cli-integration` client, the only one with
 * `ALLOW_USER_PASSWORD_AUTH` enabled — the web and mobile clients are authorization-code
 * only. For the backend to accept the resulting token, that client id must be in
 * `APP_COGNITO_CLIENT_IDS`; `run.sh` includes it, matching what staging already does in
 * `infra/terraform/secrets/main.tf`.
 *
 * The password is a function argument and nothing more. It is never stored, never put in
 * Redux, and never logged — see `SignInScreen`, which keeps it in component state that dies
 * with the screen.
 */
import axios from "axios";
import { config } from "@/constants/config";
import { AuthError } from "./AuthError";
import type { StoredSession } from "@/api/tokenStore";

interface InitiateAuthSuccess {
  AuthenticationResult?: {
    AccessToken: string;
    ExpiresIn: number;
    IdToken?: string;
    RefreshToken?: string;
    TokenType: string;
  };
  /** Present instead of AuthenticationResult when Cognito wants something more. */
  ChallengeName?: string;
}

interface CognitoErrorBody {
  __type?: string;
  message?: string;
}

/**
 * Cognito's `__type` mapped onto something a person can read.
 *
 * `prevent_user_existence_errors` is ENABLED on every client in this pool, so an unknown
 * username and a wrong password both come back as `NotAuthorizedException`. Collapsing
 * them to one message is not lost detail — it is the point, and telling them apart in the
 * UI would undo the setting.
 */
function messageKeyForCognitoError(type: string | undefined, message: string | undefined): string {
  const normalised = (type ?? "").split("#").pop() ?? "";

  switch (normalised) {
    case "NotAuthorizedException":
      // The one case worth separating: a disabled account is an administrative state the
      // user cannot fix by retyping, so "wrong password" would send them in circles.
      return message?.toLowerCase().includes("disabled")
        ? "auth.cognito.userDisabled"
        : "auth.cognito.invalidCredentials";

    case "UserNotFoundException":
      return "auth.cognito.invalidCredentials";

    // Every account in this pool starts on an admin-created temporary password
    // (`allow_admin_create_user_only = true`), so this is the likeliest first-run failure
    // and the least self-explanatory. Surfacing it precisely saves a long debugging detour.
    case "PasswordResetRequiredException":
    case "NewPasswordRequiredException":
      return "auth.cognito.newPasswordRequired";

    case "TooManyRequestsException":
    case "LimitExceededException":
    case "TooManyFailedAttemptsException":
      return "auth.cognito.tooManyAttempts";

    // Misconfiguration rather than a bad credential: the client id does not exist, or does
    // not have USER_PASSWORD_AUTH enabled. Reported as configuration so nobody spends the
    // afternoon retyping a password that was never the problem.
    case "ResourceNotFoundException":
    case "InvalidParameterException":
      return "errors.configMissing";

    default:
      return "errors.server";
  }
}

export async function signInWithPassword(
  username: string,
  password: string,
): Promise<StoredSession> {
  const { region, cliClientId } = config.cognito;

  if (!cliClientId) {
    throw new AuthError("errors.configMissing", { keys: "EXPO_PUBLIC_COGNITO_CLI_CLIENT_ID" });
  }

  let response;
  try {
    response = await axios.post<InitiateAuthSuccess>(
      `https://cognito-idp.${region}.amazonaws.com/`,
      {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: cliClientId,
        AuthParameters: { USERNAME: username, PASSWORD: password },
      },
      {
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
        },
        timeout: 15_000,
      },
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const body = error.response.data as CognitoErrorBody;
      throw new AuthError(messageKeyForCognitoError(body?.__type, body?.message), {
        keys: "EXPO_PUBLIC_COGNITO_CLI_CLIENT_ID",
      });
    }
    // No response at all — the phone is not on the same network, or is offline.
    throw new AuthError("errors.network");
  }

  const { AuthenticationResult, ChallengeName } = response.data;

  // A challenge is a 200, not an error, so it has to be checked explicitly or it reads as
  // a success with no token. NEW_PASSWORD_REQUIRED is the one that actually happens here:
  // an admin-created user still on its temporary password.
  if (!AuthenticationResult) {
    throw new AuthError(
      ChallengeName === "NEW_PASSWORD_REQUIRED"
        ? "auth.cognito.newPasswordRequired"
        : "errors.server",
    );
  }

  return {
    accessToken: AuthenticationResult.AccessToken,
    refreshToken: AuthenticationResult.RefreshToken ?? null,
    expiresAt: Date.now() + AuthenticationResult.ExpiresIn * 1000,
  };
}
