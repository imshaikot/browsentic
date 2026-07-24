import { exposeActions } from '@/lib/actions/host';

export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    // This script arrives two ways: declared in the manifest (fresh page loads) and injected
    // programmatically (tabs that were open before the extension loaded). A tab can get both,
    // and a second exposeActions() would answer every action twice.
    const world = globalThis as { __voicelinkActions?: boolean };
    if (world.__voicelinkActions) return;
    world.__voicelinkActions = true;
    exposeActions();
  },
});
