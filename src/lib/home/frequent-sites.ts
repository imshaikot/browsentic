export interface VisitedSite {
  url: string;
  title?: string;
  favicon?: string;
}

export interface FrequentSite {
  url: string;
  host: string;
  label: string;
  icon?: string;
}

export const FREQUENT_SITES = 8;

const MAX_LABEL = 20;

const TITLE_PARTS = /\s+[-–—|·•/]\s+|:\s+/;

const UNREAD_COUNT = /^\(\d+\+?\)\s*/;

export function siteHost(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol) && hostname ? hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

const squashed = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The name a site calls itself: the title part that matches its domain, else the last part, where most sites put their name. */
export function siteLabel(title: string | undefined, host: string): string {
  const parts = (title ?? '')
    .replace(UNREAD_COUNT, '')
    .split(TITLE_PARTS)
    .map((part) => part.trim())
    .filter(Boolean);
  const domain = host.split('.').at(-2) ?? host;
  const named = parts.find((part) => {
    const name = squashed(part);
    return name === domain || (domain.length >= 4 && name.includes(domain));
  });
  const label = named ?? parts.at(-1);
  return label && label.length <= MAX_LABEL ? label : host;
}

export function frequentSites(
  visited: readonly VisitedSite[],
  hidden: readonly string[],
  limit = FREQUENT_SITES,
): FrequentSite[] {
  const hosted = visited.map((site) => ({ site, host: siteHost(site.url) }));
  return hosted
    .filter(
      (entry, index): entry is { site: VisitedSite; host: string } =>
        entry.host !== null &&
        !hidden.includes(entry.host) &&
        hosted.findIndex((other) => other.host === entry.host) === index,
    )
    .slice(0, limit)
    .map(({ site, host }) => ({
      url: site.url,
      host,
      label: siteLabel(site.title, host),
      ...(site.favicon ? { icon: site.favicon } : {}),
    }));
}
