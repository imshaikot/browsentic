import { exposeActions } from '@/lib/actions/host';

export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    const world = globalThis as { __voicelinkActions?: boolean };
    if (world.__voicelinkActions) return;
    world.__voicelinkActions = true;
    exposeActions();
  },
});
