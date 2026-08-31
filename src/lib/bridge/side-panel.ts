type SidebarAction = { open: () => Promise<void>; close: () => Promise<void> };

function sidebarAction(): SidebarAction {
  return (browser as unknown as { sidebarAction: SidebarAction }).sidebarAction;
}

export function openSidePanel(windowId: number) {
  if (import.meta.env.FIREFOX) return sidebarAction().open();
  return browser.sidePanel.open({ windowId });
}

/** Firefox lets the background shut the sidebar, as long as a user gesture is still live. */
export function closeSidebar(): Promise<void> {
  return sidebarAction().close();
}

/** Only the panel itself calls this, so `window.close()` is the fallback worth having. */
export async function closeSidePanel(windowId: number | null): Promise<void> {
  try {
    if (import.meta.env.FIREFOX) {
      await sidebarAction().close();
      return;
    }
    const api = browser.sidePanel as unknown as {
      close?: (options: { windowId: number }) => Promise<void>;
    };
    if (api.close && windowId != null) {
      await api.close({ windowId });
      return;
    }
  } catch {
    /* falls through to closing the page */
  }
  if (typeof window !== 'undefined') window.close();
}
