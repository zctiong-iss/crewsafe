/**
 * Every piece of text in the app goes through here.
 *
 * That is what makes the global font-size setting work: `fontScale` is applied once, in
 * this component, on top of `react-native-size-matters`' device scaling. A raw `<Text>`
 * would silently opt out of the accessibility setting, so there should be none in `src/`.
 */
import { StyleSheet, Text, type TextProps, type TextStyle, type StyleProp } from "react-native";
import type { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { s } from "react-native-size-matters";
import { useTheme } from "@/theme/ThemeProvider";
import { AppFonts, familyFor, lineHeightBoostFor, type AppFontWeight } from "@/styles/fonts";
import { isSupportedLanguage } from "@/localization/languagesList";

export type AppTextVariant =
  /** One-off hero numbers — the WBGT reading. */
  | "display"
  | "title"
  | "subtitle"
  | "body"
  | "label"
  | "caption";

export type AppTextTone = "primary" | "secondary" | "inverse" | "danger" | "warning" | "success";

/**
 * Size, and which *weight* the variant uses — not which family.
 *
 * The family is resolved per render from the active language (SCRUM-205), because Tamil,
 * Bengali and Myanmar each need their own face and Gelasio has no glyphs for any of them.
 * Naming the weight here rather than a concrete family name is what lets one table serve
 * every script.
 */
const VARIANTS: Record<AppTextVariant, { size: number; weight: AppFontWeight }> = {
  display: { size: 40, weight: "bold" },
  title: { size: 22, weight: "bold" },
  subtitle: { size: 18, weight: "semiBold" },
  body: { size: 16, weight: "regular" },
  label: { size: 14, weight: "medium" },
  caption: { size: 12, weight: "regular" },
};

/**
 * Gelasio is a serif with tall ascenders; RN's default line height clips descenders on
 * Android at larger scales, so every variant is given this much room.
 */
export const LINE_HEIGHT_RATIO = 1.35;

/**
 * The rendered line height of a variant, in the same units a sibling's `marginTop` uses.
 *
 * Exported so that a caller aligning something *next to* text — an icon that must sit on the
 * first line's axis, say — can derive the offset instead of hardcoding a magic number that
 * silently stops matching when the variant, the device scale or the user's text size
 * changes. See `DispatchCard`'s header.
 *
 * `language` is optional but should be passed by anyone doing that alignment. Tamil, Bengali
 * and Myanmar carry a taller line box (see `lineHeightBoostFor`), so an offset computed
 * without it is correct in English and a few pixels out in three other languages — which is
 * precisely the kind of drift this function exists to prevent.
 */
export function lineHeightFor(
  variant: AppTextVariant,
  fontScale: number,
  language?: string,
): number {
  const boost =
    language && isSupportedLanguage(language) ? lineHeightBoostFor(language) : 1;
  return s(VARIANTS[variant].size) * fontScale * LINE_HEIGHT_RATIO * boost;
}

interface AppTextProps extends TextProps {
  children: ReactNode;
  variant?: AppTextVariant;
  tone?: AppTextTone;
  style?: StyleProp<TextStyle>;
}

const AppText: FC<AppTextProps> = ({
  children,
  variant = "body",
  tone = "primary",
  style,
  ...rest
}) => {
  const theme = useTheme();
  const { i18n } = useTranslation();
  const spec = VARIANTS[variant];

  /*
   * Family and line height both follow the active language.
   *
   * Read from i18n rather than from the preferences slice because i18n is what actually
   * decided which string is being rendered. Taking the family from a different source than
   * the text would let the two disagree for a frame during a language change — Tamil words
   * in Gelasio, which is tofu.
   */
  const language = isSupportedLanguage(i18n.language) ? i18n.language : "en";
  const fontFamily = familyFor(language)[spec.weight];
  const lineHeightRatio = LINE_HEIGHT_RATIO * lineHeightBoostFor(language);

  const colorForTone: Record<AppTextTone, string> = {
    primary: theme.colors.textPrimary,
    secondary: theme.colors.textSecondary,
    inverse: theme.colors.textInverse,
    danger: theme.colors.danger,
    warning: theme.colors.warning,
    success: theme.colors.success,
  };

  return (
    <Text
      {...rest}
      // The OS text-size setting would compound with ours and overshoot every layout.
      // CrewSafe exposes its own scale in Settings instead, so the cap stays honest.
      allowFontScaling={false}
      style={[
        styles.base,
        {
          fontSize: s(spec.size) * theme.fontScale,
          fontFamily,
          color: colorForTone[tone],
          // Gelasio is a serif with tall ascenders; RN's default line height clips
          // descenders on Android at larger scales. Tamil, Bengali and Myanmar need more
          // again — see `lineHeightBoostFor`.
          //
          // This is derived from the variant's size, so overriding `fontSize` through the
          // `style` prop leaves the line height behind and the text overlaps itself on
          // wrap. Size text by choosing a variant; if you genuinely must override, set
          // `lineHeight` in the same style object.
          lineHeight: s(spec.size) * theme.fontScale * lineHeightRatio,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
};

export default AppText;

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
});
