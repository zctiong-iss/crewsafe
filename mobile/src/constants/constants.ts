/**
 * Cross-cutting constants that are not configuration and not theme.
 *
 * @author Justin Chua
 */
import { Platform } from "react-native";

export const IS_Android = Platform.OS === "android";
export const IS_IOS = Platform.OS === "ios";
export const IS_WEB = Platform.OS === "web";
