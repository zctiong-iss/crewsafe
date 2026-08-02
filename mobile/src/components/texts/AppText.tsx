/**
 * Every piece of text in the app goes through here.
 *
 * That is what makes the global font-size setting work: `fontScale` is applied once, in
 * this component, on top of `react-native-size-matters`' device scaling. A raw `<Text>`
 * would silently opt out of the accessibility setting, so there should be none in `src/`.
 */
import { StyleSheet, Text, type TextProps, type TextStyle, type StyleProp } from "react-native";
import type { FC, ReactNode } from "react";
import { s } from "react-native-size-matters";
import { useTheme } from "@/theme/ThemeProvider";
import { AppFonts } from "@/styles/fonts";

export type AppTextVariant =
  /** One-off hero numbers — the WBGT reading. */
  | "display"
  | "title"
  | "subtitle"
  | "body"
  | "label"
  | "caption";

export type AppTextTone = "primary" | "secondary" | "inverse" | "danger" | "warning" | "success";

const VARIANTS: Record<AppTextVariant, { size: number; family: string }> = {
  display: { size: 40, family: AppFonts.bold },
  title: { size: 22, family: AppFonts.bold },
  subtitle: { size: 18, family: AppFonts.semiBold },
  body: { size: 16, family: AppFonts.regular },
  label: { size: 14, family: AppFonts.medium },
  caption: { size: 12, family: AppFonts.regular },
};

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
  const spec = VARIANTS[variant];

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
          fontFamily: spec.family,
          color: colorForTone[tone],
          // Gelasio is a serif with tall ascenders; RN's default line height clips
          // descenders on Android at larger scales.
          //
          // This is derived from the variant's size, so overriding `fontSize` through the
          // `style` prop leaves the line height behind and the text overlaps itself on
          // wrap. Size text by choosing a variant; if you genuinely must override, set
          // `lineHeight` in the same style object.
          lineHeight: s(spec.size) * theme.fontScale * 1.35,
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
