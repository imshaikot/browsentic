import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { SKILLS_INDEX_KEY, type StoredSkillMeta } from './skill-store';

/**
 * The uploaded-skill index, kept live through `storage.local.onChanged` so it stays in sync
 * across extension pages and re-renders pending→saved as the background pushes each one to
 * the daemon.
 */
export function useStoredSkills(): StoredSkillMeta[] {
  const [skills, setSkills] = useState<StoredSkillMeta[]>([]);

  useEffect(() => {
    let live = true;
    void browser.storage.local.get(SKILLS_INDEX_KEY).then((stored) => {
      const list = stored[SKILLS_INDEX_KEY];
      if (live && Array.isArray(list)) setSkills(list as StoredSkillMeta[]);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (SKILLS_INDEX_KEY in changes) {
        const next = changes[SKILLS_INDEX_KEY].newValue;
        setSkills(Array.isArray(next) ? (next as StoredSkillMeta[]) : []);
      }
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  return skills;
}
