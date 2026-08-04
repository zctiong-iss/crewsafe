/**
 * Sign in.
 *
 * One screen, three flows. Which controls appear depends on the active auth mode, but the
 * submit path is identical in every case: `dispatch(signIn(...))`, and the navigator swaps
 * itself when the status becomes "signed-in". The screen never navigates by hand — see
 * `RootNavigator` for why.
 *
 *   mock              a demo-user picker. No network at all.
 *   cognito-password  username and password, sent to Cognito's InitiateAuth.
 *   cognito-pkce      a single button; the Hosted UI opens in a browser.
 *
 * The mode selector at the bottom is compiled out of release bundles by the `__DEV__`
 * guard, and `assertModeAllowed` refuses the dev-only modes at the point of use as well —
 * a hidden control is not an access control.
 */
import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, type TextInput } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppTextInputController from "@/components/inputs/AppTextInputController";
import RadioWithTitle from "@/components/inputs/RadioWithTitle";
import MessageBanner from "@/components/feedback/MessageBanner";
import AppLoader from "@/components/feedback/AppLoader";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { signIn, signOut } from "@/store/reducers/authSlice";
import { getAuthMode, setAuthMode } from "@/auth/authMode";
import { DEMO_USERS } from "@/auth/demoUsers";
import LanguageSheet from "@/components/sheets/LanguageSheet";
import type { AuthMode } from "@/constants/config";
import type { AuthStackParamList } from "@/navigation/types";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

const MODE_LABEL_KEYS: Record<AuthMode, string> = {
  mock: "auth.modeMock",
  "cognito-password": "auth.modeCognitoPassword",
  "cognito-pkce": "auth.modeCognitoPkce",
};

const ALL_MODES: AuthMode[] = ["mock", "cognito-password", "cognito-pkce"];

export default function SignInScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();

  const signingIn = useAppSelector((state) => state.auth.signingIn);
  const errorKey = useAppSelector((state) => state.auth.errorKey);
  const errorParams = useAppSelector((state) => state.auth.errorParams);
  const requestId = useAppSelector((state) => state.auth.requestId);

  const [mode, setMode] = useState<AuthMode>(getAuthMode());
  const [demoUserId, setDemoUserId] = useState<string>(DEMO_USERS[0].id);
  const [languageSheetOpen, setLanguageSheetOpen] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  /*
   * The schema is rebuilt when `t` changes, so switching language re-renders the validation
   * messages rather than leaving whichever language was active when the schema was first
   * created. This is the whole reason the messages are produced here instead of being
   * module-level constants.
   *
   * Only presence is checked. A minimum length would be wrong on a sign-in form: the rule
   * belongs to the pool's password policy, and enforcing it here would reject a legitimate
   * older password while telling the user nothing they can act on.
   */
  const schema = useMemo(
    () =>
      yup.object({
        username: yup.string().trim().required(t("auth.validation.usernameRequired")),
        password: yup.string().required(t("auth.validation.passwordRequired")),
      }),
    [t],
  );

  type FormData = yup.InferType<typeof schema>;

  const { control, handleSubmit } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  const onChangeMode = (next: AuthMode) => {
    setAuthMode(next);
    setMode(next);
    /*
     * Discard any stored session before switching.
     *
     * Tokens are not interchangeable across modes. A `mock.<id>` sentinel left behind by
     * mock mode would be sent as a real bearer to the backend under a Cognito mode and come
     * back 401 as "not provisioned"; a real Cognito token left behind would be parsed as a
     * mock sentinel and resolve to no fixture. Both present as a confusing failure at the
     * *next* launch rather than at the switch, which is the worst time to discover it.
     *
     * `signOut` also clears the error, so this covers the stale-banner case too.
     */
    void dispatch(signOut());
  };

  const submitPassword = handleSubmit((data) =>
    // `data.password` is passed straight through and never stored: it lives in the form's
    // own state, which dies with this screen. It is not in Redux and not persisted.
    dispatch(signIn({ username: data.username.trim(), password: data.password })),
  );

  const onSubmit = () => {
    if (mode === "mock") {
      void dispatch(signIn({ demoUserId }));
      return;
    }
    if (mode === "cognito-pkce") {
      void dispatch(signIn({}));
      return;
    }
    void submitPassword();
  };

  // Replaces the form outright rather than covering it. An overlay would have to sit above
  // a focused keyboard and a scrolled form, and there is nothing on this screen worth
  // seeing behind a spinner.
  if (signingIn) {
    return (
      <AppSafeView edges={["top", "bottom", "left", "right"]}>
        <AppLoader fullscreen message={t("auth.signingIn")} />
      </AppSafeView>
    );
  }

  return (
    <AppSafeView edges={["top", "bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        // Without "handled", the first tap on a button only dismisses the keyboard and the
        // user has to tap again — which reads as an unresponsive button.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <AppText variant="display">{t("common.appName")}</AppText>
          <AppText variant="body" tone="secondary" style={styles.subtitle}>
            {t("auth.signInSubtitle")}
          </AppText>
        </View>

        {errorKey ? (
          <View style={styles.banner}>
            <MessageBanner message={t(errorKey, errorParams)} tone="danger" requestId={requestId} />
          </View>
        ) : null}

        {mode === "mock" ? (
          <View style={styles.section}>
            <AppText variant="label" style={styles.sectionLabel}>
              {t("auth.demoUserLabel")}
            </AppText>
            {/* `.map`, not FlatList: three compile-time fixtures, and a VirtualizedList
                nested in a ScrollView warns and scrolls badly. FlatList is for the real,
                server-driven lists — the inbox and the shift list. */}
            {DEMO_USERS.map((user) => (
              <RadioWithTitle
                key={user.id}
                title={user.displayName}
                subtitle={t(`roles.${user.role}`)}
                selected={user.id === demoUserId}
                onPress={() => setDemoUserId(user.id)}
              />
            ))}
          </View>
        ) : null}

        {mode === "cognito-password" ? (
          <View style={styles.section}>
            <AppTextInputController<FormData>
              control={control}
              name="username"
              label={t("auth.usernameLabel")}
              placeholder={t("auth.usernamePlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              submitBehavior="submit"
            />
            <AppTextInputController<FormData>
              ref={passwordRef}
              control={control}
              name="password"
              label={t("auth.passwordLabel")}
              placeholder={t("auth.passwordPlaceholder")}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />
          </View>
        ) : null}

        {mode === "cognito-pkce" ? (
          <View style={styles.section}>
            <MessageBanner message={t("auth.pkceHint")} tone="info" />
          </View>
        ) : null}

        <View style={styles.actions}>
          <AppButton title={t("auth.signInButton")} onPress={onSubmit} loading={signingIn} />
          <AppButton
            title={t("auth.signUpButton")}
            variant="secondary"
            style={styles.secondaryButton}
            onPress={() => navigation.navigate("SignUp")}
          />
          {/*
            Language has to be reachable from here, not only from Settings.

            Settings sits behind sign-in (Profile → Settings), and the preferences slice is
            deliberately device-level rather than per-user — so it survives a sign-out. On a
            shared site phone that combination is a trap: the previous worker leaves the app
            in Hindi, the next one reads only Chinese, and the one screen that could fix it
            is on the other side of a login they now cannot navigate.

            The button is labelled in the *currently selected* language, and the sheet lists
            every option in its own script, so finding it never depends on being able to
            read the language you are stuck in.
          */}
          <AppButton
            title={t("settings.changeLanguage")}
            variant="secondary"
            style={styles.secondaryButton}
            icon={<Ionicons name="language" size={s(18)} color={theme.colors.textPrimary} />}
            onPress={() => setLanguageSheetOpen(true)}
          />

          <LanguageSheet
            visible={languageSheetOpen}
            onClose={() => setLanguageSheetOpen(false)}
          />
        </View>

        {__DEV__ ? (
          <View
            style={[
              styles.devPanel,
              { borderTopColor: theme.colors.border, borderTopWidth: theme.metrics.borderWidth },
            ]}
          >
            <AppText variant="caption" tone="secondary" style={styles.sectionLabel}>
              {t("auth.modeLabel")}
            </AppText>
            {ALL_MODES.map((option) => (
              <RadioWithTitle
                key={option}
                title={t(MODE_LABEL_KEYS[option])}
                selected={option === mode}
                onPress={() => onChangeMode(option)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </AppSafeView>
  );
}

const styles = StyleSheet.create({
  content: {
    // flexGrow rather than flex: lets the content centre itself when short, and scroll
    // when the keyboard or a large text setting makes it tall.
    flexGrow: 1,
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(24),
  },
  header: {
    alignItems: "center",
    marginBottom: vs(24),
  },
  subtitle: {
    marginTop: vs(4),
    textAlign: "center",
  },
  banner: {
    marginBottom: vs(16),
  },
  section: {
    marginBottom: vs(8),
  },
  sectionLabel: {
    marginBottom: vs(8),
  },
  actions: {
    marginTop: vs(8),
  },
  secondaryButton: {
    marginTop: vs(12),
  },
  devPanel: {
    marginTop: vs(28),
    paddingTop: vs(12),
  },
});
