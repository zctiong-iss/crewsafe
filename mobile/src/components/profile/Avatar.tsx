/**
 * The profile avatar: an image when there is one, initials when there is not.
 *
 * @author Justin Chua
 */
import { Image, StyleSheet, View } from "react-native";
import type { FC } from "react";
import { s } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

interface AvatarProps {
  uri: string | null;
  displayName: string;
  size: number;
}

/**
 * Derives up to two initials from a display name.
 *
 * `Array.from` rather than `split("")` so a name outside the Basic Multilingual Plane is
 * not cut in half mid-surrogate — which renders as a replacement glyph rather than a
 * letter. Names in this workforce include CJK and Devanagari, where a single character is
 * a whole name, so one initial is a legitimate result and not a bug.
 */
function initialsFor(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  const lastWord = words.at(-1);
  return [words[0], lastWord ?? words[0]]
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

const Avatar: FC<AvatarProps> = ({ uri, displayName, size }) => {
  const theme = useTheme();
  const dimension = s(size);

  /*
   * `lineHeight` is set alongside `fontSize` deliberately.
   *
   * AppText derives its line height from the variant, so overriding only the size leaves
   * the two mismatched and the glyphs sit visibly off-centre in the circle — the exact
   * footgun AppText's own comment warns about.
   */
  const initialsStyle = {
    fontSize: dimension * 0.36,
    lineHeight: dimension * 0.44,
  };

  return (
    <View
      // Announced as one thing. Without this a screen reader reads the initials as loose
      // letters — "S", "W" — which is noise, not information.
      accessibilityRole="image"
      accessibilityLabel={displayName}
      style={[
        styles.container,
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.borderStrong,
          borderWidth: theme.metrics.borderWidth,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          // The container is already circular; without this the square image overflows the
          // rounded corners on Android, which ignores parent borderRadius when clipping.
          style={{ width: dimension, height: dimension, borderRadius: dimension / 2 }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <AppText variant="title" style={initialsStyle}>
          {initialsFor(displayName)}
        </AppText>
      )}
    </View>
  );
};

export default Avatar;

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
