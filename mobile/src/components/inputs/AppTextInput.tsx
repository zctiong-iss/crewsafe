/**
 * A labelled text field with error and hint states.
 *
 * @author Justin Chua
 */
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { forwardRef } from "react";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import { AppFonts } from "@/styles/fonts";

export interface AppTextInputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  /** Rendered below the field, in danger tone, and wired to accessibility state. */
  errorMessage?: string;
  hint?: string;
}

/**
 * `forwardRef` so a form can move focus to the next field on submit — and so a failed
 * submit can focus the first field that errored rather than leaving the user to hunt for
 * it on a small screen.
 */
const AppTextInput = forwardRef<TextInput, AppTextInputProps>(
  ({ label, errorMessage, hint, ...rest }, ref) => {
    const theme = useTheme();
    const hasError = Boolean(errorMessage);
    const helperMessage = errorMessage ?? hint;
    const helperTone: "danger" | "secondary" = hasError ? "danger" : "secondary";

    return (
      <View style={styles.wrapper}>
        {/* Ternary rather than `label && ...` — an empty string is falsy but still renders
            as a bare text child, which React Native throws on outside a <Text>. */}
        {label ? (
          <AppText variant="label" style={styles.label}>
            {label}
          </AppText>
        ) : null}

        <TextInput
          ref={ref}
          // An erroring field must not rely on a red border alone — that is invisible to a
          // colour-blind user and washes out in sun. React Native's AccessibilityState has
          // no `invalid` member, so the message is folded into the label instead, which has
          // the better outcome anyway: the field and its error are announced together
          // rather than as two separate stops in the reading order.
          accessibilityLabel={hasError && label ? `${label}. ${errorMessage}` : label}
          accessibilityHint={hint}
          placeholderTextColor={theme.colors.placeholder}
          // Matches AppText. Without it the OS text-size setting scales what the user types
          // but not the label above it, so the two disagree inside the same field — and the
          // OS scale would compound with ours on top.
          allowFontScaling={false}
          style={[
            styles.input,
            {
              color: theme.colors.textPrimary,
              backgroundColor: theme.colors.surface,
              borderColor: hasError ? theme.colors.danger : theme.colors.border,
              // A thicker stroke gives the error a second, non-colour signal.
              borderWidth: hasError ? theme.metrics.borderWidth + 1 : theme.metrics.borderWidth,
              borderRadius: theme.metrics.radius,
              fontSize: s(16) * theme.fontScale,
              minHeight: Math.max(theme.metrics.minTouchTarget, vs(44) * theme.fontScale),
            },
          ]}
          {...rest}
        />

        {helperMessage ? (
          <AppText variant="caption" tone={helperTone} style={styles.helper}>
            {helperMessage}
          </AppText>
        ) : null}
      </View>
    );
  },
);

AppTextInput.displayName = "AppTextInput";

export default AppTextInput;

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: vs(14),
  },
  label: {
    marginBottom: vs(6),
  },
  input: {
    width: "100%",
    paddingHorizontal: s(14),
    paddingVertical: vs(10),
    fontFamily: AppFonts.regular,
  },
  helper: {
    marginTop: vs(4),
  },
});
