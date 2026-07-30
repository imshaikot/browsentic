export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: unknown;
}

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
