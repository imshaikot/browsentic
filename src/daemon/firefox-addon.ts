const RELEASES = process.env.BROWSENTIC_RELEASES ?? 'https://github.com/imshaikot/browsentic/releases';

export const RELEASES_PAGE = `${RELEASES}/latest`;

/** The add-on addons.mozilla.org signed for this same version, hung under its GitHub release. */
export function signedAddonUrl(version: string): string {
  return `${RELEASES}/download/v${version}/browsentic-${version}-firefox.xpi`;
}

/**
 * Whether the release carries the signed file yet, or null when GitHub is unreachable.
 * Mozilla signs after the release exists, so for a few minutes after a tag — or longer,
 * when a human at Mozilla looks at it — the link is right but the file is not there.
 */
export async function signedAddonAttached(version: string, timeoutMs = 4_000): Promise<boolean | null> {
  try {
    const response = await fetch(signedAddonUrl(version), { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return null;
  }
}
