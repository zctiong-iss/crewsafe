/**
 * Take a photo, choose one, or remove the current one.
 *
 * ── PERMISSIONS ARE ASKED FOR AT THE POINT OF USE ───────────────────────────────────────
 * Not on mount, and not at app start. A permission prompt makes sense to someone who has
 * just tapped "Take a photo" and is baffling to someone who opened Settings — and on both
 * platforms a denial is sticky, so a prompt fired at the wrong moment can permanently cost
 * the feature. A denial here is explained rather than swallowed, because the recovery is in
 * device settings and nobody guesses that on their own.
 */
import { useState } from "react";
import { Alert, StyleSheet } from "react-native";
import type { FC } from "react";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";

import BottomSheet from "./BottomSheet";
import AppText from "../texts/AppText";
import AppButton from "../buttons/AppButton";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { avatarCleared, avatarSet } from "@/store/reducers/profileSlice";
import { showToast } from "@/store/reducers/uiSlice";
import { deleteAvatar, persistAvatar } from "@/helpers/avatarStorage";
import { useTheme } from "@/theme/ThemeProvider";

/** Square, and modest. A 4000px photo behind a 96pt circle is wasted storage on a work phone. */
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.7,
};

interface AvatarSheetProps {
  visible: boolean;
  onClose: () => void;
}

const AvatarSheet: FC<AvatarSheetProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);
  const currentUri = useAppSelector((state) =>
    user ? (state.profile.avatars[user.id] ?? null) : null,
  );

  const [busy, setBusy] = useState(false);

  const apply = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !user) return;
    const picked = result.assets[0]?.uri;
    if (!picked) return;

    // Copied out of the picker's cache before the URI is stored — see `avatarStorage`.
    const stored = await persistAvatar(picked, user.id);
    // The previous file goes only after the new one is safely in place.
    deleteAvatar(currentUri);

    dispatch(avatarSet({ userId: user.id, uri: stored }));
    dispatch(showToast({ messageKey: "profile.photoUpdatedToast", tone: "success" }));
  };

  const onTakePhoto = async () => {
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("profile.permissionDeniedTitle"), t("profile.cameraDeniedBody"), [
          { text: t("common.close") },
        ]);
        return;
      }
      await apply(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const onChooseFromLibrary = async () => {
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("profile.permissionDeniedTitle"), t("profile.libraryDeniedBody"), [
          { text: t("common.close") },
        ]);
        return;
      }
      await apply(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const onRemove = () => {
    if (!user) return;
    deleteAvatar(currentUri);
    dispatch(avatarCleared(user.id));
    dispatch(showToast({ messageKey: "profile.photoRemovedToast", tone: "success" }));
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t("profile.photoSheetTitle")}>
      {/* Said here, where the choice is being made, rather than only on the screen behind.
          A worker should know the photo stays on the phone *before* they take it. */}
      <AppText variant="caption" tone="secondary" style={styles.notice}>
        {t("profile.photoLocalOnly")}
      </AppText>

      <AppButton
        title={t("profile.takePhoto")}
        onPress={() => void onTakePhoto()}
        loading={busy}
        icon={<Ionicons name="camera" size={s(18)} color={theme.colors.onPrimary} />}
        style={styles.action}
      />

      <AppButton
        title={t("profile.chooseFromLibrary")}
        variant="secondary"
        onPress={() => void onChooseFromLibrary()}
        loading={busy}
        icon={<Ionicons name="images" size={s(18)} color={theme.colors.textPrimary} />}
        style={styles.action}
      />

      {currentUri ? (
        <AppButton
          title={t("profile.removePhoto")}
          variant="danger"
          onPress={onRemove}
          style={styles.action}
        />
      ) : null}
    </BottomSheet>
  );
};

export default AvatarSheet;

const styles = StyleSheet.create({
  notice: {
    marginBottom: vs(14),
  },
  action: {
    marginBottom: vs(10),
  },
});
