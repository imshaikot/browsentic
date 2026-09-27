; An update runs the old uninstaller too, with /UPDATE; only a real uninstall stops the daemon and
; takes browsentic off the PATH. What the daemon keeps in ~/.browsentic stays, as it does when the
; macOS app goes to the Trash; the app's own Uninstall removes that.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall'
  ${EndIf}
!macroend
