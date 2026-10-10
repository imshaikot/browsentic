/** The Android tab's words in both apps. The Windows app imports these; the Mac app's `AndroidCopy` repeats them and must match. */
export const PHONE_TAB_COPY = {
  title: 'Drive Chrome on your Android phone',
  subtitle: "Browsentic Bridge reaches Chrome on your phone through adb, Android's debugging tool. Nothing is installed on the phone.",
  phoneCard: 'Your phone',
  guideCard: 'Set up your phone',
  guideSubtitle: 'Once per phone. After that, plug it in and open Chrome.',
  checkAgain: 'Check again',
  openChrome: 'Open Chrome on the phone',
  getChrome: 'Get Chrome',
  copyInstall: 'Copy install command',
  downloadTools: 'Download platform-tools',
  usbDrivers: "Find your phone's USB driver",
  offline: 'Phone checks',
  androidEleven: 'Android 11 or later',
} as const;

export const PLATFORM_TOOLS_URL = 'https://developer.android.com/tools/releases/platform-tools';
export const OEM_USB_DRIVERS_URL = 'https://developer.android.com/studio/run/oem-usb';
