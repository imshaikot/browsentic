import { FrequentSites } from '@/extension/components/frequent-sites';
import { useNewTabChoice } from '@/lib/bridge/use-extension-settings';
import { useFrequentSites } from '@/lib/bridge/use-frequent-sites';
import { hideSite } from '@/lib/settings/new-tab';

/** A new tab with Browsentic Home switched off, in a browser whose own new tab page an extension cannot open. */
export function PlainNewTab({ onTurnOn }: { onTurnOn: () => void }) {
  const [choice, setChoice] = useNewTabChoice();
  const frequent = useFrequentSites(choice.sites, choice.hidden);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 pb-[14vh]">
      <div className="w-full max-w-[44rem]">
        {choice.sites && <FrequentSites frequent={frequent} onHide={(host) => setChoice(hideSite(choice, host))} />}
      </div>
      <button
        type="button"
        onClick={() => {
          setChoice({ ...choice, home: true });
          onTurnOn();
        }}
        className="fixed right-4 bottom-4 text-[11px] text-ink-faint transition-colors hover:text-ink-dim"
      >
        Turn Browsentic Home on
      </button>
    </main>
  );
}
