import { describe, expect, test } from 'vitest';
import { displayName, isSavedToolSkill, scopeOf, skillNameFor, slugFromPurpose, toolMatchesUrl, type ToolScope } from './saved-tool';

const watch: ToolScope = { host: 'youtube.com', segment: 'watch' };
const PATH_SAFE = /^[a-z0-9][a-z0-9-]{0,47}$/;

// Scope decides where a tool is offered; the skill name becomes `join(skillsDir, name + '.md')`,
// so a user-shaped string must never survive into it.
describe('scope', () => {
  test('scope takes host and first segment', () => {
    expect(scopeOf('https://www.youtube.com/watch?v=abc')).toEqual(watch);
  });

  test('www is not part of the host', () => {
    expect(scopeOf('https://www.github.com/pulls')?.host).toBe('github.com');
  });

  test('a bare origin scopes to root', () => {
    expect(scopeOf('https://example.com/')?.segment).toBe('root');
  });

  test('a non-http url has no scope', () => {
    expect(scopeOf('file:///etc/passwd')).toBeNull();
  });

  test('a chrome page has no scope', () => {
    expect(scopeOf('chrome://extensions')).toBeNull();
  });

  test('the display name reads host first', () => {
    expect(displayName(watch, 'darken-page')).toBe('youtube.com:watch:darken-page');
  });
});

describe('matching a url', () => {
  test('another id under the same segment matches', () => {
    expect(toolMatchesUrl(watch, 'https://youtube.com/watch?v=zzz')).toBe(true);
  });

  test('a deeper path under the segment matches', () => {
    expect(toolMatchesUrl(watch, 'https://youtube.com/watch/live')).toBe(true);
  });

  test('a different segment does not', () => {
    expect(toolMatchesUrl(watch, 'https://youtube.com/results?q=cats')).toBe(false);
  });

  test('the site root does not', () => {
    expect(toolMatchesUrl(watch, 'https://youtube.com/')).toBe(false);
  });

  test('a subdomain does not', () => {
    expect(toolMatchesUrl(watch, 'https://music.youtube.com/watch?v=abc')).toBe(false);
  });
});

describe('skill names', () => {
  const skillName = skillNameFor(watch, 'darken-page-except-video-player');
  const hostile = skillNameFor({ host: '../../etc', segment: '..' }, 'x/../../y');

  test('the skill name is path-safe', () => {
    expect(skillName).toMatch(PATH_SAFE);
  });

  test('the skill name is recognisable as a tool', () => {
    expect(isSavedToolSkill(skillName)).toBe(true);
  });

  test('traversal cannot survive into a skill name', () => {
    expect(hostile).toMatch(PATH_SAFE);
  });

  test('and it carries no separators', () => {
    expect(hostile).not.toMatch(/[/.]/);
  });

  test('a purpose becomes a slug', () => {
    expect(slugFromPurpose('Darken the page except the video player', 'fn')).toBe('darken-page-except-video-player');
  });

  test('a purpose of only stop words falls back', () => {
    expect(slugFromPurpose('the a of', 'darkenPage')).toBe('darkenpage');
  });
});
