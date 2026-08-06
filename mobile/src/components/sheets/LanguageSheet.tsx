/**
 * The language picker, as a bottom sheet.
 *
 * ── APPLIED IMMEDIATELY, NOT ON CONFIRM ─────────────────────────────────────────────────
 * The reference app puts a Confirm button under the list. That is the wrong shape for this
 * particular setting: the effect of choosing a language is visible instantly and everywhere,
 * so the choice confirms itself. A worker who does not read English well and has tapped into
 * this sheet by accident is better served by seeing the app change and tapping their own
 * language back than by having to find and interpret a Confirm button in a language they
 * cannot read.
 *
 * Each option is labelled in its own script for the same reason — someone looking for Hindi
 * should not have to read the word "Hindi" in English to find it.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";

import BottomSheet from "./BottomSheet";
import RadioWithTitle from "../inputs/RadioWithTitle";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setLanguage } from "@/store/reducers/preferencesSlice";
import { languagesArr, type AppLanguage } from "@/localization/languagesList";

interface LanguageSheetProps {
  visible: boolean;
  onClose: () => void;
}

const LanguageSheet: FC<LanguageSheetProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const current = useAppSelector((state) => state.preferences.language);

  const onSelect = (code: AppLanguage) => {
    // The store is the single source of truth; `LanguageSync` pushes it into i18next.
    // Nothing here talks to i18next directly, or the two could disagree after a rehydrate.
    dispatch(setLanguage(code));
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t("settings.changeLanguage")}>
      {/* `.map`, not FlatList: three compile-time entries, and a VirtualizedList inside a
          sheet scrolls badly. */}
      {languagesArr.map((language) => (
        <RadioWithTitle
          key={language.code}
          title={language.label}
          selected={language.code === current}
          onPress={() => onSelect(language.code)}
        />
      ))}
    </BottomSheet>
  );
};

export default LanguageSheet;
