/** Set on every host the extension draws into a page, so nothing that picks from the page can land on one. */
export const OVERLAY_ATTRIBUTE = 'data-browsentic-overlay';

export const isOverlay = (element: Element): boolean => element.hasAttribute(OVERLAY_ATTRIBUTE);
