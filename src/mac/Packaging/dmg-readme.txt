Browsentic for macOS

Drag Browsentic onto the Applications folder, then open it.

The app checks what your Mac already has, installs what is missing with one click, and
puts the browsentic command, the daemon and the browser extension where they belong:

    ~/.browsentic            the command, the daemon, pairing keys, config and logs
    ~/browsentic/extension   the unpacked extension your browser loads

The extension sits outside the dotfolder on purpose. Chrome's "Load unpacked" picker
hides dotfolders, and a browser's pairing is tied to the extension's path.

This build is signed ad hoc and is not notarized. If macOS refuses to open it,
right-click the app and choose Open once, or run:

    xattr -dr com.apple.quarantine /Applications/Browsentic.app

Free and open source, MIT. https://browsentic.com
