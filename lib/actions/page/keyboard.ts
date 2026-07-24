export type Modifier = 'ctrl' | 'shift' | 'alt' | 'meta';

interface LegacyKeyboardEventInit extends KeyboardEventInit {
  keyCode?: number;
  which?: number;
}

const NAMED: Record<string, { code: string; keyCode: number }> = {
  Enter: { code: 'Enter', keyCode: 13 },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ' ': { code: 'Space', keyCode: 32 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
};

function physical(key: string): { code: string; keyCode: number } {
  if (NAMED[key]) return NAMED[key];
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return { code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
    if (key >= '0' && key <= '9') return { code: `Digit${key}`, keyCode: key.charCodeAt(0) };
  }
  return { code: '', keyCode: 0 };
}

/** Build a realistic KeyboardEventInit, including legacy keyCode/which for older handlers. */
export function keyboardInit(key: string, modifiers: Modifier[] = []): LegacyKeyboardEventInit {
  const { code, keyCode } = physical(key);
  return {
    key,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: modifiers.includes('ctrl'),
    shiftKey: modifiers.includes('shift'),
    altKey: modifiers.includes('alt'),
    metaKey: modifiers.includes('meta'),
  };
}
