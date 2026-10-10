import { dispatch } from '@/lib/actions/dispatch';
import { resolveTarget, targetSchema } from '@/lib/actions/page/dom';
import { steerLens } from '@/lib/actions/page/lens';
import { isFrameElement } from '@/lib/actions/page/switch-frame';

export const PHONE_API = '__browsenticPhone';

/**
 * What the phone's page bundle puts in its isolated world: the actions' own `dispatch`, the
 * visual viewport a touch is measured from, the frame element a frame switch enters, and the
 * A-Eye lens the mirror steers.
 */
export function installPhoneApi(): void {
  (globalThis as Record<string, unknown>)[PHONE_API] = {
    dispatch,
    lens: steerLens,
    viewport: () => ({
      left: visualViewport?.offsetLeft ?? 0,
      top: visualViewport?.offsetTop ?? 0,
      width: visualViewport?.width ?? innerWidth,
      height: visualViewport?.height ?? innerHeight,
    }),
    frame: (target: unknown) => {
      const element = resolveTarget(targetSchema.parse(target));
      if (!isFrameElement(element)) throw new Error(`<${element.tagName.toLowerCase()}> is not an <iframe>; pick one of the frames page.getPageInfo lists`);
      return element;
    },
  };
}
