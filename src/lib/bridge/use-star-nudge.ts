import { useEffect, useRef, useState } from 'react';
import { STAR_NUDGE_KEY, asStarNudge, isDue, noteClosed, noteFinishedTurn, noteStarred, openRepositoryBeside } from './star-nudge';
import { useLocalSetting } from './use-extension-settings';
import type { CompletedTurn } from './use-run';

export interface StarNudgeView {
  raised: boolean;
  star: () => void;
  close: () => void;
}

/** Raised by a turn that finished cleanly in the conversation on screen, and only there. */
export function useStarNudge(completed: CompletedTurn | null, onScreen: string | null): StarNudgeView {
  const [nudge] = useLocalSetting(STAR_NUDGE_KEY, asStarNudge);
  const [raisedIn, setRaisedIn] = useState<string | null>(null);
  const watching = useRef(onScreen);

  useEffect(() => {
    watching.current = onScreen;
  }, [onScreen]);

  useEffect(() => {
    if (!completed || completed.sessionId !== watching.current) return;
    let live = true;
    void noteFinishedTurn(completed.sessionId).then((next) => {
      if (live && isDue(next, completed.sessionId)) setRaisedIn(completed.sessionId);
    });
    return () => {
      live = false;
    };
  }, [completed]);

  return {
    raised: raisedIn !== null && raisedIn === onScreen && isDue(nudge, raisedIn),
    star: () => {
      void openRepositoryBeside();
      void noteStarred();
    },
    close: () => {
      if (raisedIn) void noteClosed(raisedIn);
    },
  };
}
