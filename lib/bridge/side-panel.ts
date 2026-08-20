type SidebarAction = { open: () => Promise<void> };

export function openSidePanel(windowId: number) {
  if (import.meta.env.FIREFOX) {
    return (browser as unknown as { sidebarAction: SidebarAction }).sidebarAction.open();
  }
  return browser.sidePanel.open({ windowId });
}
