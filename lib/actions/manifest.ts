/** One action as it crosses the wire and becomes an MCP tool. */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: unknown;
}

/**
 * Fingerprint a manifest so the daemon can spot an extension built from a different registry.
 * FNV-1a: sync and dependency-free, so the browser and Node agree without WebCrypto's async split.
 * Drift detection only — never a security boundary.
 */
export function hashManifest(tools: readonly ToolDescriptor[]): string {
  let hash = 0x811c9dc5;
  const canonical = JSON.stringify(
    [...tools]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, description, inputSchema }) => [name, description, inputSchema]),
  );
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
