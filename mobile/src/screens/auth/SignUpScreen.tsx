/**
 * Request an account.
 *
 * ── WHY THIS DOES NOT REGISTER ANYONE ───────────────────────────────────────────────────
 * There is no sign-up endpoint to call, and there cannot be one today:
 *
 *   1. The Cognito pool is created with `allow_admin_create_user_only = true`
 *      (`infra/terraform/cognito/main.tf`), so self-service registration is switched off at
 *      the identity provider itself. No client-side change reaches past that.
 *   2. Even with a Cognito user, CrewSafe's own `app_user` row — which is what actually
 *      grants a role and site access — is provisioned by `DemoDataSeeder` from a reviewed
 *      repository variable. There is no API that writes one. A Cognito login with no
 *      application mapping is authenticated but unauthorized.
 *
 * So this screen does the honest version of its job: it validates the request properly and
 * hands the user something to send to whoever can actually create the account. It never
 * pretends to have submitted anything, and it never invents a local account that the
 * backend would reject on the first request.
 *
 * To make it live, both layers need work — a Terraform change enabling self-registration
 * (or an admin-invite workflow), and a backend endpoint that provisions the application
 * user with role WORKER and a site membership, audited under FR-04. Higher roles must stay
 * administrator-created regardless: this screen deliberately offers no role choice.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, type TextInput } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import * as Clipboard from "expo-clipboard";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppTextInputController from "@/components/inputs/AppTextInputController";
import RadioWithTitle from "@/components/inputs/RadioWithTitle";
import MessageBanner from "@/components/feedback/MessageBanner";

import { SITE_OPTIONS } from "@/constants/siteCodes";
import type { AuthStackParamList } from "@/navigation/types";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Mirrors the `username` pattern in `.github/cognito/shared-config.schema.json`, which is
 * what a reviewer will validate the request against. Catching a bad username here saves a
 * round trip through a human.
 */
const USERNAME_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

/**
 * Characters that must never reach a free-text field here.
 *
 * The prepared request is assembled as newline-separated `Label: value` lines and copied to
 * the clipboard for a human administrator to read and act on. That makes every free-text
 * field an injection point: a full name pasted as
 *
 *     Ada Lovelace\nRequested role: Administrator
 *
 * forges an extra line in a document whose whole purpose is to tell someone which account
 * to create. The role is stated by the app, never chosen by the user — this is what stops
 * the user smuggling one in anyway.
 *
 * The class covers more than newlines. U+202E (right-to-left override) and the bidi
 * isolates visually reorder text without changing its bytes, so a name can be made to
 * *render* as something other than what it says. Zero-width characters hide content
 * outright. None of them belong in a name, a username, or an email.
 *
 * Written as explicit ranges rather than \p{Cc}\p{Cf}: unicode property escapes need the
 * `u` flag and engine support, and this has to be right on Hermes.
 */
const CONTROL_OR_BIDI_SOURCE =
  "[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]";

const CONTROL_OR_BIDI = new RegExp(CONTROL_OR_BIDI_SOURCE);

const MIN_NAME_LENGTH = 2;

/** Matches `display_name` in the shared Cognito config schema and DemoDataSeeder's check. */
const MAX_NAME_LENGTH = 100;
const MAX_USERNAME_LENGTH = 64;
/** RFC 5321's maximum forward-path length. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Belt and braces for the clipboard payload.
 *
 * Validation already rejects these characters, so this should be a no-op — but it is the
 * function that actually builds the text an administrator will act on, and it costs one
 * line to make the guarantee local rather than inherited from a schema three hundred lines
 * away that someone may later relax.
 */
function singleLine(value: string): string {
  return value.replace(new RegExp(CONTROL_OR_BIDI_SOURCE, "g"), " ").replace(/\s+/g, " ").trim();
}

interface PreparedRequest {
  fullName: string;
  username: string;
  email: string;
  siteCode: string;
  siteName: string;
}

export default function SignUpScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();

  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [copied, setCopied] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Without this, dismissing the screen inside the two-second window leaves a timer holding
  // a setState on an unmounted component.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  /*
   * Rebuilt when `t` changes so a language switch re-renders the messages rather than
   * leaving whichever language was active when the schema was first built.
   */
  const schema = useMemo(
    () =>
      yup.object({
        fullName: yup
          .string()
          .trim()
          .required(t("signUp.validation.fullNameRequired"))
          .min(MIN_NAME_LENGTH, t("signUp.validation.fullNameTooShort", { min: MIN_NAME_LENGTH }))
          .max(MAX_NAME_LENGTH, t("signUp.validation.fullNameTooLong", { max: MAX_NAME_LENGTH }))
          // Rejected rather than silently stripped: a name that renders differently from
          // what was typed is exactly the thing worth telling the user about.
          .test(
            "single-line",
            t("signUp.validation.singleLineOnly"),
            (value) => !value || !CONTROL_OR_BIDI.test(value),
          ),
        username: yup
          .string()
          .trim()
          .required(t("signUp.validation.usernameRequired"))
          .max(MAX_USERNAME_LENGTH, t("signUp.validation.usernameTooLong", { max: MAX_USERNAME_LENGTH }))
          // The pattern alone already excludes every control character, but the explicit
          // test keeps the three fields consistent and survives a loosened pattern.
          .matches(USERNAME_PATTERN, t("signUp.validation.usernameFormat")),
        email: yup
          .string()
          .trim()
          .required(t("signUp.validation.emailRequired"))
          .max(MAX_EMAIL_LENGTH, t("signUp.validation.emailTooLong", { max: MAX_EMAIL_LENGTH }))
          .email(t("signUp.validation.emailInvalid"))
          .test(
            "single-line",
            t("signUp.validation.singleLineOnly"),
            (value) => !value || !CONTROL_OR_BIDI.test(value),
          ),
        siteCode: yup.string().required(t("signUp.validation.siteRequired")),
      }),
    [t],
  );

  type FormData = yup.InferType<typeof schema>;

  const { control, handleSubmit } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: { fullName: "", username: "", email: "", siteCode: "" },
  });

  const onSubmit = handleSubmit((data) => {
    const site = SITE_OPTIONS.find((option) => option.code === data.siteCode);
    // `singleLine` should be a no-op here — validation already rejected anything it would
    // strip. It runs anyway because this is the value that becomes a line in a document an
    // administrator acts on, and that guarantee is worth holding locally.
    setPrepared({
      fullName: singleLine(data.fullName),
      username: singleLine(data.username),
      email: singleLine(data.email),
      siteCode: data.siteCode,
      siteName: site?.name ?? data.siteCode,
    });
    setCopied(false);
  });

  const summaryLines = (request: PreparedRequest): { label: string; value: string }[] => [
    { label: t("signUp.fullNameLabel"), value: request.fullName },
    { label: t("signUp.usernameLabel"), value: request.username },
    { label: t("signUp.emailLabel"), value: request.email },
    { label: t("signUp.siteLabel"), value: `${request.siteName} (${request.siteCode})` },
  ];

  const onCopy = async (request: PreparedRequest) => {
    const text = [
      t("signUp.requestHeading"),
      t("signUp.roleLine"),
      ...summaryLines(request).map((line) => `${line.label}: ${line.value}`),
    ].join("\n");

    await Clipboard.setStringAsync(text);
    setCopied(true);

    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  /* ------------------------------- Prepared request ------------------------------- */

  if (prepared) {
    return (
      <AppSafeView>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <AppText variant="title">{t("signUp.successTitle")}</AppText>
          <AppText variant="body" tone="secondary" style={styles.intro}>
            {t("signUp.successBody")}
          </AppText>

          <View
            style={[
              styles.card,
              cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
              { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
            ]}
          >
            <AppText variant="label" style={styles.summaryHeading}>
              {t("signUp.roleLine")}
            </AppText>
            {summaryLines(prepared).map((line) => (
              <View key={line.label} style={styles.summaryRow}>
                <AppText variant="caption" tone="secondary">
                  {line.label}
                </AppText>
                {/* No flex row here: label above value. A right-aligned value would wrap
                    awkwardly for a long email on a narrow screen. */}
                <AppText variant="body" style={styles.summaryValue}>
                  {line.value}
                </AppText>
              </View>
            ))}
          </View>

          <AppButton
            title={copied ? t("signUp.copiedButton") : t("signUp.copyButton")}
            onPress={() => void onCopy(prepared)}
            style={styles.action}
          />
          <AppButton
            title={t("signUp.editButton")}
            variant="secondary"
            onPress={() => setPrepared(null)}
            style={styles.action}
          />
          <AppButton
            title={t("signUp.backToSignIn")}
            variant="secondary"
            onPress={() => navigation.navigate("SignIn")}
            style={styles.action}
          />
        </ScrollView>
      </AppSafeView>
    );
  }

  /* ------------------------------------ Form ------------------------------------- */

  return (
    <AppSafeView>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AppText variant="body" tone="secondary" style={styles.intro}>
          {t("signUp.intro")}
        </AppText>

        {/* Stated up front, not buried next to a disabled control. A worker who needs a
            supervisor account should stop reading here rather than fill in four fields. */}
        <View style={styles.banner}>
          <MessageBanner message={t("signUp.roleNotice")} tone="info" />
        </View>

        <AppTextInputController<FormData>
          control={control}
          name="fullName"
          label={t("signUp.fullNameLabel")}
          placeholder={t("signUp.fullNamePlaceholder")}
          autoCapitalize="words"
          // Stops an over-long paste at the source rather than only reporting it after
          // submit. The yup rule stays as the authority — this is a courtesy.
          maxLength={MAX_NAME_LENGTH}
          returnKeyType="next"
          onSubmitEditing={() => usernameRef.current?.focus()}
          submitBehavior="submit"
        />

        <AppTextInputController<FormData>
          ref={usernameRef}
          control={control}
          name="username"
          label={t("signUp.usernameLabel")}
          placeholder={t("signUp.usernamePlaceholder")}
          hint={t("signUp.validation.usernameFormat")}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={MAX_USERNAME_LENGTH}
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          submitBehavior="submit"
        />

        <AppTextInputController<FormData>
          ref={emailRef}
          control={control}
          name="email"
          label={t("signUp.emailLabel")}
          placeholder={t("signUp.emailPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          maxLength={MAX_EMAIL_LENGTH}
          returnKeyType="done"
        />

        <Controller
          control={control}
          name="siteCode"
          render={({ field: { onChange, value }, fieldState: { error } }) => (
            <View
              style={styles.section}
              accessibilityRole="radiogroup"
              accessibilityLabel={t("signUp.siteLabel")}
            >
              <AppText variant="label" style={styles.sectionLabel}>
                {t("signUp.siteLabel")}
              </AppText>

              {SITE_OPTIONS.map((option) => (
                <RadioWithTitle
                  key={option.code}
                  title={option.name}
                  selected={value === option.code}
                  onPress={() => onChange(option.code)}
                />
              ))}

              {error ? (
                <AppText variant="caption" tone="danger" style={styles.sectionError}>
                  {error.message}
                </AppText>
              ) : null}
            </View>
          )}
        />

        <AppButton title={t("signUp.submitButton")} onPress={() => void onSubmit()} />
      </ScrollView>
    </AppSafeView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(16),
  },
  intro: {
    marginBottom: vs(16),
  },
  banner: {
    marginBottom: vs(20),
  },
  section: {
    marginBottom: vs(20),
  },
  sectionLabel: {
    marginBottom: vs(4),
  },
  sectionError: {
    marginTop: vs(4),
  },
  card: {
    marginTop: vs(16),
    marginBottom: vs(24),
    padding: s(14),
  },
  summaryHeading: {
    marginBottom: vs(12),
  },
  summaryRow: {
    marginBottom: vs(10),
  },
  summaryValue: {
    marginTop: vs(2),
  },
  action: {
    marginBottom: vs(12),
  },
});
