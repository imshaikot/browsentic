import { X } from 'lucide-react';

import { AgentPicker } from '@/extension/components/agent-picker';
import { DaemonLink } from '@/extension/components/daemon-link';
import { Button } from '@/extension/components/ui/button';

export function ConnectionSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="enters max-h-[60%] shrink-0 overflow-y-auto border-b border-line bg-ground-2/80 px-3 py-3 backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">Connection</p>
        <Button variant="ghost" size="icon-sm" aria-label="Close connection settings" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="space-y-4">
        <DaemonLink />
        <AgentPicker />
      </div>
    </div>
  );
}
