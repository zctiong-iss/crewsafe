/**
 * Gelasio, designed by Eben Sorkin — the project's global typeface.
 *
 * Loaded from `@expo-google-fonts/gelasio` rather than committed .ttf files: the package
 * ships the same binaries, keeps them out of git, and gives us the exact family-name
 * constants below so a typo becomes a compile error instead of a silent fallback to the
 * system font. A silent fallback is easy to miss on Android, where the default face is
 * close enough to pass a glance.
 */
export const AppFonts = {
  regular: "Gelasio_400Regular",
  medium: "Gelasio_500Medium",
  semiBold: "Gelasio_600SemiBold",
  bold: "Gelasio_700Bold",
} as const;

export type AppFontWeight = keyof typeof AppFonts;
