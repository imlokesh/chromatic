!macro customInstall
  WriteRegStr HKCU "Software\Classes\Chromatic.Profile" "" "Chromatic profile"
  WriteRegStr HKCU "Software\Classes\Chromatic.Profile\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\Chromatic.Profile\shell" "" "open"
  WriteRegStr HKCU "Software\Classes\Chromatic.Profile\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open "%1"'
  WriteRegStr HKCU "Software\Classes\Chromatic.Profile\shell\edit" "" "Edit profile"
  WriteRegStr HKCU "Software\Classes\Chromatic.Profile\shell\edit\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --edit "%1"'
  WriteRegStr HKCU "Software\Classes\.chromatic" "" "Chromatic.Profile"
!macroend
!macro customUnInstall
  ReadRegStr $0 HKCU "Software\Classes\.chromatic" ""
  StrCmp $0 "Chromatic.Profile" 0 +2
  DeleteRegKey HKCU "Software\Classes\.chromatic"
  DeleteRegKey HKCU "Software\Classes\Chromatic.Profile"
!macroend
