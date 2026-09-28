/**
 * What the user tells the agent about themselves from the settings page: the details a form may
 * ask for, and rules for every task. The daemon keeps it in profile.json and puts whatever is
 * filled in into each side-panel run's system prompt, so the model uses these values rather than
 * guessing at them.
 */

export const PROFILE_FIELDS = [
  { id: 'givenName', label: 'First name', autocomplete: 'given-name' },
  { id: 'familyName', label: 'Last name', autocomplete: 'family-name' },
  { id: 'email', label: 'Email', autocomplete: 'email' },
  { id: 'phone', label: 'Phone', autocomplete: 'tel' },
  { id: 'street', label: 'Street address', autocomplete: 'street-address', multiline: true },
  { id: 'city', label: 'City', autocomplete: 'address-level2' },
  { id: 'region', label: 'State / region', autocomplete: 'address-level1' },
  { id: 'postalCode', label: 'Postal code', autocomplete: 'postal-code' },
  { id: 'country', label: 'Country', autocomplete: 'country-name' },
  { id: 'company', label: 'Company', autocomplete: 'organization' },
  { id: 'jobTitle', label: 'Job title', autocomplete: 'organization-title' },
] as const;

export type ProfileFieldId = (typeof PROFILE_FIELDS)[number]['id'];

export interface ProfileDetail {
  readonly label: string;
  readonly value: string;
}

export interface UserProfile {
  readonly fields: Partial<Record<ProfileFieldId, string>>;
  /** Anything the fixed fields do not cover, labelled by the user. */
  readonly details: readonly ProfileDetail[];
  /** Rules the user wants kept on every task. */
  readonly instructions: string;
}

export const PROFILE_LIMITS = { value: 300, label: 60, details: 20, instructions: 4000 } as const;

export const EMPTY_PROFILE: UserProfile = { fields: {}, details: [], instructions: '' };

const FIELD_IDS: readonly string[] = PROFILE_FIELDS.map((field) => field.id);

export function isProfileFieldId(value: string): value is ProfileFieldId {
  return FIELD_IDS.includes(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fits = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;

const isDetail = (value: unknown): value is ProfileDetail =>
  isRecord(value) && fits(value.label, PROFILE_LIMITS.label) && fits(value.value, PROFILE_LIMITS.value);

export function isUserProfile(value: unknown): value is UserProfile {
  return (
    isRecord(value) &&
    isRecord(value.fields) &&
    Object.entries(value.fields).every(([id, text]) => isProfileFieldId(id) && fits(text, PROFILE_LIMITS.value)) &&
    Array.isArray(value.details) &&
    value.details.length <= PROFILE_LIMITS.details &&
    value.details.every(isDetail) &&
    fits(value.instructions, PROFILE_LIMITS.instructions)
  );
}

/** Trimmed, with every empty field and every detail missing a label or a value left out. */
export function normalizeProfile(profile: UserProfile): UserProfile {
  const fields: Partial<Record<ProfileFieldId, string>> = {};
  for (const { id } of PROFILE_FIELDS) {
    const text = profile.fields[id]?.trim();
    if (text) fields[id] = text;
  }
  const details = profile.details
    .map((detail) => ({ label: detail.label.trim(), value: detail.value.trim() }))
    .filter((detail) => detail.label && detail.value);
  return { fields, details, instructions: profile.instructions.trim() };
}

/**
 * What a hand-edited profile.json can be read as: every entry that fits kept, anything that does
 * not left out, never cut short — a truncated phone number is worse than none.
 */
export function asUserProfile(value: unknown): UserProfile {
  if (!isRecord(value)) return EMPTY_PROFILE;
  const fields = isRecord(value.fields)
    ? Object.fromEntries(
        Object.entries(value.fields).filter(([id, text]) => isProfileFieldId(id) && fits(text, PROFILE_LIMITS.value)),
      )
    : {};
  const details = Array.isArray(value.details) ? value.details.filter(isDetail).slice(0, PROFILE_LIMITS.details) : [];
  const instructions = fits(value.instructions, PROFILE_LIMITS.instructions) ? value.instructions : '';
  return normalizeProfile({ fields, details, instructions });
}

export function isEmptyProfile(profile: UserProfile): boolean {
  const normal = normalizeProfile(profile);
  return !Object.keys(normal.fields).length && !normal.details.length && !normal.instructions;
}

export function sameProfile(a: UserProfile, b: UserProfile): boolean {
  return JSON.stringify(normalizeProfile(a)) === JSON.stringify(normalizeProfile(b));
}
