import { useEffect, useRef, useState } from 'react';
import { STAR_NUDGE_KEY, asStarNudge, noteFinishedTurn, noteStarred, openRepositoryBeside } from './star-nudge';
import { useLocalSetting } from './use-extension-settings';
import type { CompletedTurn } from './use-run';

export interface StarNudgeView {
  raised: boolean;
  star: () => void;
  close: () => void;
}

/**
 * Raised at most once in a conversation, by a turn that finished cleanly while it was on screen. The
 * next run there takes it down, and a star clicked in any panel retires it everywhere.
 */
export function useStarNudge(completed: CompletedTurn | null, onScreen: string | null, running: boolean): StarNudgeView {
  const [nudge] = useLocalSetting(STAR_NUDGE_KEY, asStarNudge);
  const [raisedIn, setRaisedIn] = useState<string | null>(null);
  const watching = useRef(onScreen);

  useEffect(() => {
    watching.current = onScreen;
  }, [onScreen]);

  useEffect(() => {
    if (running) setRaisedIn(null);
  }, [running]);

  useEffect(() => {
    if (!completed || completed.sessionId !== watching.current) return;
    void noteFinishedTurn(completed.sessionId).then((asks) => {
      if (asks) setRaisedIn(completed.sessionId);
    });
  }, [completed]);

  return {
    raised: raisedIn !== null && raisedIn === onScreen && !nudge.starred,
    star: () => {
      setRaisedIn(null);
      void openRepositoryBeside();
      void noteStarred();
    },
    close: () => setRaisedIn(null),
  };
}
