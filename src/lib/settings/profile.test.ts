import { describe, expect, test } from 'vitest';
import { asUserProfile, isEmptyProfile, isUserProfile, normalizeProfile, PROFILE_LIMITS, sameProfile } from './profile';

const full = {
  fields: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', street: '12 St James’s Square\nFlat 3' },
  details: [{ label: 'Frequent flyer', value: 'BA 123456' }],
  instructions: 'Always choose the cheapest shipping.',
};

describe('what a settings page may save as the profile', () => {
  test('known fields, labelled details and instructions', () => {
    expect(isUserProfile(full)).toBe(true);
    expect(isUserProfile({ fields: {}, details: [], instructions: '' })).toBe(true);
  });

  test('anything else is refused before it reaches profile.json', () => {
    const refused = [
      null,
      [],
      { ...full, fields: { nickname: 'Ada' } },
      { ...full, fields: { email: 42 } },
      { ...full, fields: { email: 'a'.repeat(PROFILE_LIMITS.value + 1) } },
      { ...full, details: [{ label: 'x'.repeat(PROFILE_LIMITS.label + 1), value: 'y' }] },
      { ...full, details: Array.from({ length: PROFILE_LIMITS.details + 1 }, () => ({ label: 'a', value: 'b' })) },
      { ...full, details: [{ label: 'Loyalty' }] },
      { ...full, instructions: 'x'.repeat(PROFILE_LIMITS.instructions + 1) },
      { fields: {}, details: [] },
    ];
    expect(refused.map(isUserProfile)).toEqual(refused.map(() => false));
  });
});

describe('what is kept', () => {
  test('values are trimmed, and empty fields and half-filled details are left out', () => {
    const profile = normalizeProfile({
      fields: { givenName: '  Ada ', familyName: '   ', email: '' },
      details: [
        { label: ' Loyalty ', value: ' 991 ' },
        { label: '', value: 'no label' },
        { label: 'No value', value: '  ' },
      ],
      instructions: '\n  Be brief.  \n',
    });
    expect(profile).toEqual({ fields: { givenName: 'Ada' }, details: [{ label: 'Loyalty', value: '991' }], instructions: 'Be brief.' });
  });

  test('a profile with nothing filled in is empty, whatever whitespace it holds', () => {
    expect(isEmptyProfile({ fields: { email: ' ' }, details: [{ label: ' ', value: '' }], instructions: '\n' })).toBe(true);
    expect(isEmptyProfile({ fields: {}, details: [], instructions: 'Be brief.' })).toBe(false);
  });

  test('two profiles that differ only in whitespace are the same', () => {
    expect(sameProfile(full, { ...full, instructions: ` ${full.instructions} ` })).toBe(true);
    expect(sameProfile(full, { ...full, instructions: 'Be brief.' })).toBe(false);
  });

  test('a hand-edited file keeps every entry that fits and never cuts one short', () => {
    const read = asUserProfile({
      fields: { email: 'ada@example.com', phone: '1'.repeat(PROFILE_LIMITS.value + 1), nickname: 'Ada' },
      details: [{ label: 'Loyalty', value: '991' }, 'stray', { label: 'Broken' }],
      instructions: 7,
    });
    expect(read).toEqual({ fields: { email: 'ada@example.com' }, details: [{ label: 'Loyalty', value: '991' }], instructions: '' });
    expect(asUserProfile('not a profile')).toEqual({ fields: {}, details: [], instructions: '' });
  });
});
