import { browser } from 'wxt/browser';
import { INDICATOR_COLOR, isIndicatorCommand } from './events';

export { INDICATOR_CHANNEL } from './events';

const ICON_SIZE = 32;

const LINK_ID = 'browsentic-run-icon';

export function exposeIndicator(): void {
  let original: string | null = null;
  let marked = false;

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isIndicatorCommand(message)) return;
    if (message.op === 'busy') void mark();
    else restore();
    return Promise.resolve({ ok: true });
  });

  async function mark(): Promise<void> {
    if (marked) return;
    marked = true;
    const href = currentIconHref();
    if (original === null) original = href ?? '';
    const dotted = await withDot(href);
    if (!dotted || !marked) return;
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = LINK_ID;
      link.rel = 'icon';
      document.head.append(link);
    }
    link.href = dotted;
    for (const other of iconLinks()) if (other.id !== LINK_ID) other.remove();
  }

  function restore(): void {
    if (!marked) return;
    marked = false;
    document.getElementById(LINK_ID)?.remove();
    if (!original) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = original;
    document.head.append(link);
  }
}

const iconLinks = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];

function currentIconHref(): string | null {
  const link = iconLinks().find((candidate) => candidate.id !== LINK_ID && candidate.href);
  return link?.href ?? null;
}

async function withDot(href: string | null): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const base = href ? await loadImage(href) : null;
  if (base) context.drawImage(base, 0, 0, ICON_SIZE, ICON_SIZE);

  const radius = ICON_SIZE * 0.3;
  const centre = ICON_SIZE - radius - 1;
  context.beginPath();
  context.arc(centre, centre, radius + 2, 0, Math.PI * 2);
  context.fillStyle = 'rgba(0, 0, 0, 0.55)';
  context.fill();
  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.fillStyle = INDICATOR_COLOR;
  context.fill();

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function loadImage(href: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = href;
  });
}
