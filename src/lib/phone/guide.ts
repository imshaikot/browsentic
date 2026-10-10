export interface GuideStep {
  title: string;
  detail: string;
  /** Shown only for phones on that Android version or later. */
  platform?: 'android11+';
}

/** The one copy of the phone setup steps. The CLI and the Windows app read it; the Mac app mirrors it by hand and must match. */
export const PHONE_GUIDE: readonly GuideStep[] = [
  {
    title: 'Turn on Developer options',
    detail: 'On the phone, open Settings, then About phone, and tap Build number seven times.',
  },
  {
    title: 'Turn on USB debugging',
    detail: 'Open Settings, then System, then Developer options, and turn on USB debugging.',
  },
  {
    title: 'Connect the phone',
    detail: 'Connect it to this computer with a USB cable. When the phone asks, tick "Always allow from this computer" and tap Allow.',
  },
  {
    title: 'Or connect over Wi-Fi',
    detail:
      'In Developer options, turn on Wireless debugging and tap Pair device with pairing code. On this computer, run "adb pair <ip:port> <code>", then "adb connect <ip:port>".',
    platform: 'android11+',
  },
  {
    title: 'Open Chrome on the phone',
    detail: 'Browsentic drives the Chrome app, so it has to be open.',
  },
  {
    title: 'Switch on Android',
    detail: 'In your browser, open the Browsentic side panel and switch on Android.',
  },
];
