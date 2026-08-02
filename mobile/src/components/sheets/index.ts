/**
 * Sheet registration, imported once for its side effects.
 *
 * `react-native-actions-sheet` v10 registers sheets by id rather than rendering them where
 * they are used — so a sheet can be opened from anywhere with `SheetManager.show(id)`
 * without the caller importing the component or owning its visibility state. That earns its
 * indirection here: the language picker is opened from Settings *and* from the sign-in
 * screen, which sits outside the signed-in navigator entirely.
 *
 * The module augmentation below is what makes `SheetManager.show("language-sheet")` a
 * compile-time-checked id instead of a magic string.
 */
import { registerSheet, type SheetDefinition } from "react-native-actions-sheet";
import LanguageSheet, { LANGUAGE_SHEET_ID } from "./LanguageSheet";
import AvatarSheet, { AVATAR_SHEET_ID } from "./AvatarSheet";

registerSheet(LANGUAGE_SHEET_ID, LanguageSheet);
registerSheet(AVATAR_SHEET_ID, AvatarSheet);

declare module "react-native-actions-sheet" {
  interface Sheets {
    "language-sheet": SheetDefinition;
    "avatar-sheet": SheetDefinition;
  }
}

export { LANGUAGE_SHEET_ID, AVATAR_SHEET_ID };
