/**
 * Avatar colour assignment.
 *
 * Names only live here; the actual classes are the Avatar component's business.
 * The point of hashing the seed is stability: the same payee keeps the same
 * colour between screens, refetches and sessions, which is what makes a row of
 * faces feel like a real address book instead of a random palette.
 */

export type AvatarTone =
  | "brand"
  | "slate"
  | "emerald"
  | "gradient"
  | "ocean"
  | "meadow"
  | "sunset"
  | "berry"
  | "dusk";

/** The tones used for people, in the order the hash walks them. */
const CONTACT_TONES: readonly AvatarTone[] = [
  "ocean",
  "meadow",
  "sunset",
  "berry",
  "dusk",
  "gradient",
];

export function avatarToneFor(seed: string | null | undefined): AvatarTone {
  const key = (seed ?? "").trim().toLowerCase();
  if (!key) return "gradient";

  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 100_003;
  }
  return CONTACT_TONES[hash % CONTACT_TONES.length];
}
