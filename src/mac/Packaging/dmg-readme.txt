Browsentic for macOS

Drag Browsentic onto the Applications folder, then open it.

The app checks what your Mac already has, installs what is missing with one click, and
puts the browsentic command, the daemon and the browser extension where they belong:

    ~/.browsentic            the command, the daemon, pairing keys, config and logs
    ~/browsentic/extension   the unpacked extension your browser loads

The extension sits outside the dotfolder on purpose. Chrome's "Load unpacked" picker
hides dotfolders, and a browser's pairing is tied to the extension's path.

If macOS says it "could not verify Browsentic is free of malware", this build was
not notarized by Apple. Press Done, open System Settings > Privacy & Security,
scroll down to the Browsentic line and press Open Anyway. Or run this once:

    xattr -dr com.apple.quarantine /Applications/Browsentic.app

Free and open source, MIT. https://browsentic.com
