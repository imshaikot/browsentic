import { exposeActions } from '@/lib/actions/host';
import { exposeRecorder } from '@/lib/recordings/host';

export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    const world = globalThis as { __browsenticActions?: boolean };
    if (world.__browsenticActions) return;
    world.__browsenticActions = true;
    exposeActions();
    exposeRecorder();
  },
});
