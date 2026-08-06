/**
 * Keeping a picked profile photo alive.
 *
 * ── WHY THIS IS NOT JUST "STORE THE URI" ────────────────────────────────────────────────
 * `expo-image-picker` hands back a URI in the app's *cache* directory, which
 * `expo-file-system` documents plainly as "a place to store files that can be deleted by
 * the system when the device runs low on storage". Persisting that URI works right up until
 * the phone gets full — then the avatar silently becomes a broken image, on a device that
 * is out of space and therefore the least likely to be debugged calmly.
 *
 * So the file is copied into the document directory, which is "safe from being deleted by
 * the system", and it is *that* path that gets persisted.
 *
 * ── WHY THE FILENAME CARRIES A TIMESTAMP ────────────────────────────────────────────────
 * React Native's `Image` caches by URI. Writing a replacement photo to the same path would
 * leave the old one on screen until the cache happened to evict it — the user picks a new
 * face and nothing changes, which reads as the feature being broken. A fresh filename each
 * time sidesteps the cache entirely; the previous file is deleted explicitly.
 *
 * @author Justin Chua
 */
import { Directory, File, Paths } from "expo-file-system";

const AVATAR_DIRECTORY = "avatars";

function avatarDirectory(): Directory {
  const directory = new Directory(Paths.document, AVATAR_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true });
  }
  return directory;
}

/**
 * Copies a picked image somewhere durable and returns the new URI.
 *
 * Falls back to the original URI rather than throwing: a profile photo is not worth failing
 * a user action over, and the cache URI does work — just not indefinitely. Better a photo
 * that might vanish in a year than an error dialog today.
 */
export async function persistAvatar(sourceUri: string, userId: string): Promise<string> {
  try {
    const extension = sourceUri.split(".").pop()?.split("?")[0] ?? "jpg";
    const safeExtension = /^[a-zA-Z0-9]{2,4}$/.test(extension) ? extension : "jpg";

    const destination = new File(
      avatarDirectory(),
      `avatar-${userId}-${Date.now()}.${safeExtension}`,
    );

    await new File(sourceUri).copy(destination);
    return destination.uri;
  } catch {
    return sourceUri;
  }
}

/**
 * Best-effort cleanup of a replaced or removed photo.
 *
 * Never throws. The file may already be gone, may never have been copied out of the cache
 * (see the fallback above), or may belong to a directory the OS has since cleared — none of
 * which the caller can do anything useful about.
 */
export function deleteAvatar(uri: string | null | undefined): void {
  if (!uri) return;
  // Only ever delete inside our own avatars directory. A URI that fell back to the picker's
  // cache path is not ours to remove, and deleting an arbitrary path because it happened to
  // be stored here would be a nasty way to lose a user's photo library entry.
  if (!uri.includes(`/${AVATAR_DIRECTORY}/`)) return;

  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing actionable.
  }
}
