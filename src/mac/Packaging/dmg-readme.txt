Browsentic for macOS

Drag Browsentic onto the Applications folder, then open it.

This app is Browsentic Bridge, the half of Browsentic that runs on your Mac. It checks
what your Mac already has, installs what is missing with one click, and keeps it all in

    ~/.browsentic            the command, pairing keys, config and logs

The other half is the extension in your browser. The app's Overview tab opens its store
page in the browser you pick: the Chrome Web Store for Chrome, Brave, Arc, Vivaldi
and Opera, Edge Add-ons for Edge, or the signed add-on for Firefox. Click Browsentic
in the toolbar and enter the pairing code the app shows, once.

If macOS says it "could not verify Browsentic is free of malware", this build was
not notarized by Apple. Press Done, open System Settings > Privacy & Security,
scroll down to the Browsentic line and press Open Anyway. Or run this once:

    xattr -dr com.apple.quarantine /Applications/Browsentic.app

Free and open source, Apache 2.0. No API key, no account. https://browsentic.com
