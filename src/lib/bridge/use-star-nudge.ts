import { useEffect, useRef, useState } from 'react';
import { STAR_NUDGE_KEY, asStarNudge, isDue, noteClosed, noteFinishedTurn, noteStarred, openRepositoryBeside } from './star-nudge';
import { useLocalSetting } from './use-extension-settings';
import type { CompletedTurn } from './use-run';

export interface StarNudgeView {
  raised: boolean;
  star: () => void;
  close: () => void;
}

interface Raise {
  sessionId: string;
  closes: number;
}

/**
 * Raised by a turn that finished cleanly in the conversation on screen, and only there. The next run
 * there takes it down, so a turn that fails or is stopped never brings it back, and a close in any
 * other panel retires it.
 */
export function useStarNudge(completed: CompletedTurn | null, onScreen: string | null, running: boolean): StarNudgeView {
  const [nudge] = useLocalSetting(STAR_NUDGE_KEY, asStarNudge);
  const [raise, setRaise] = useState<Raise | null>(null);
  const watching = useRef(onScreen);

  useEffect(() => {
    watching.current = onScreen;
  }, [onScreen]);

  useEffect(() => {
    if (running) setRaise(null);
  }, [running]);

  useEffect(() => {
    if (!completed || completed.sessionId !== watching.current) return;
    void noteFinishedTurn(completed.sessionId).then((next) => {
      if (isDue(next, completed.sessionId)) setRaise({ sessionId: completed.sessionId, closes: next.closes });
    });
  }, [completed]);

  return {
    raised: raise !== null && raise.sessionId === onScreen && raise.closes === nudge.closes && isDue(nudge, raise.sessionId),
    star: () => {
      setRaise(null);
      void openRepositoryBeside();
      void noteStarred();
    },
    close: () => {
      if (!raise) return;
      setRaise(null);
      void noteClosed(raise.sessionId);
    },
  };
}
