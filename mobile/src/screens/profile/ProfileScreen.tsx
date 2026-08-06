/**
 * Who you are signed in as, and the way out.
 *
 * ── EVERYTHING HERE EXCEPT THE PHOTO IS SERVER TRUTH ────────────────────────────────────
 * Name, username, role and site count all come from `GET /api/v1/me`, which is re-fetched
 * on every launch precisely because role and site membership are revocable. None of it is
 * editable from the app: there is no endpoint that would accept a change, and role in
 * particular is administered (FR-01/FR-02) rather than self-selected — an editable role
 * field would be a privilege-escalation control with a friendly label.
 *
 * The photo is the one exception, and it never leaves the device. See `profileSlice`.
 *
 * @author Justin Chua
 */
import { useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import Avatar from "@/components/profile/Avatar";
import AvatarSheet from "@/components/sheets/AvatarSheet";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { signOut } from "@/store/reducers/authSlice";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { ProfileStackParamList } from "@/navigation/types";

export default function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();

  const user = useAppSelector((state) => state.auth.user);
  const signingOut = useAppSelector((state) => state.auth.signingOut);
  const avatarUri = useAppSelector((state) =>
    user ? (state.profile.avatars[user.id] ?? null) : null,
  );

  // Declared before the early return below: hooks must run unconditionally on every render.
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);

  // Only ever mounts inside a signed-in tab tree, so this is unreachable — but rendering
  // nothing beats crashing if that stops being true.
  if (!user) return null;

  const rows = [
    { label: t("profile.username"), value: user.username },
    { label: t("profile.role"), value: t(`roles.${user.role}`) },
    { label: t("profile.sites"), value: String(user.siteIds.length) },
  ];

  return (
    <AppSafeView>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setAvatarSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={avatarUri ? t("profile.changePhoto") : t("profile.addPhoto")}
            style={styles.avatarTarget}
          >
            <Avatar uri={avatarUri} displayName={user.displayName} size={96} />

            {/* Sits on the avatar's edge rather than beside it, so the whole thing reads as
                one tappable object. Bordered in the surface colour so it stays legible over
                either a photo or the initials block behind it. */}
            <View
              style={[
                styles.editBadge,
                {
                  backgroundColor: theme.colors.primary,
                  borderColor: theme.colors.surface,
                  borderWidth: theme.metrics.borderWidth + 1,
                },
              ]}
            >
              <Ionicons name="camera" size={s(14)} color={theme.colors.onPrimary} />
            </View>
          </TouchableOpacity>

          <AppText variant="title" style={styles.name}>
            {user.displayName}
          </AppText>
        </View>

        <View
          style={[
            styles.card,
            cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
            { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
          ]}
        >
          {rows.map((row, index) => (
            <View
              key={row.label}
              style={[
                styles.row,
                index > 0 && {
                  borderTopWidth: theme.metrics.borderWidth,
                  borderTopColor: theme.colors.border,
                },
              ]}
            >
              <AppText variant="label" tone="secondary" style={styles.rowLabel}>
                {row.label}
              </AppText>
              {/*
                One line, truncated in the middle rather than wrapped.

                Wrapping let a long value push its second line below the label, so the two
                stopped reading as a pair and the row's height changed per user — a
                47-character synthetic username took two lines while "Worker" took one.
                Pinning to a single line keeps every row the same height on any screen size
                and at any text scale.

                `middle` rather than `tail` because these values are identifiers: for
                `synthetic-worker@synthetic.crewsafe.invalid` the informative parts are the
                name at the front and the domain at the end, and tail truncation would eat
                the domain entirely.
              */}
              <AppText
                variant="body"
                style={styles.rowValue}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {row.value}
              </AppText>
            </View>
          ))}
        </View>

        <AppButton
          title={t("tabs.settings")}
          variant="secondary"
          onPress={() => navigation.navigate("Settings")}
          icon={<Ionicons name="settings-outline" size={s(18)} color={theme.colors.textPrimary} />}
          style={styles.action}
        />

        {/* Sign-out is not instant — it revokes the refresh token over the network and, on
            the PKCE flow, waits on a browser. Without the loading state the button looks
            dead for as long as that takes, and gets tapped again. */}
        <AppButton
          title={t("auth.signOutButton")}
          variant="danger"
          loading={signingOut}
          onPress={() => void dispatch(signOut())}
          style={styles.action}
        />

        <AvatarSheet visible={avatarSheetOpen} onClose={() => setAvatarSheetOpen(false)} />
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
  header: {
    alignItems: "center",
    marginBottom: vs(20),
  },
  avatarTarget: {
    // The badge is positioned against this, so it must not clip.
    position: "relative",
  },
  editBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: s(30),
    height: s(30),
    borderRadius: s(15),
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    marginTop: vs(12),
    textAlign: "center",
  },
  card: {
    marginBottom: vs(20),
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    // Both on the same axis. With a single-line value this also vertically centres the
    // pair, which "flex-start" would not once the label and value differ in size.
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: vs(12),
    paddingHorizontal: s(14),
  },
  rowLabel: {
    // Never squeezed: "Username" is short and fixed, and shrinking it would truncate the
    // label before the value it describes.
    flexShrink: 0,
    marginEnd: s(12),
  },
  rowValue: {
    // Takes whatever the label leaves and truncates inside it, so the row is exactly one
    // line wide on a 320dp phone and a tablet alike.
    flex: 1,
    textAlign: "right",
  },
  action: {
    marginBottom: vs(12),
  },
});
