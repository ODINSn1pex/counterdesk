; Lumora – Installer (installiert standardmäßig nach Desktop\Lumora)
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"

!define APP "Lumora"
!define VER "5.0.0"
!define EXE "Lumora.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lumora"

Name "${APP}"
!ifndef SRC
  !define SRC "win-unpacked"
!endif
!ifndef SUFFIX
  !define SUFFIX ""
!endif
OutFile "..\release\Lumora-Setup-${VER}${SUFFIX}.exe"
InstallDir "$DESKTOP\${APP}"
InstallDirRegKey HKCU "Software\Lumora" "InstallDir"
RequestExecutionLevel user
BrandingText "${APP} ${VER}"

VIProductVersion "3.0.0.0"
VIAddVersionKey /LANG=1031 "ProductName" "${APP}"
VIAddVersionKey /LANG=1031 "FileDescription" "${APP} Setup"
VIAddVersionKey /LANG=1031 "FileVersion" "${VER}"
VIAddVersionKey /LANG=1031 "LegalCopyright" "© 2026 ${APP}"

!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "wizard.bmp"
!define MUI_WELCOMEPAGE_TITLE "Willkommen bei ${APP}"
!define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert ${APP} – die Bildbearbeitung für Profis und Einsteiger.$\r$\n$\r$\nStandardmäßig wird ein neuer Ordner „${APP}“ auf deinem Desktop angelegt. Darin liegen das Programm (${EXE}) und der Unterordner „Projekte“ für deine Arbeiten.$\r$\n$\r$\nKlicke auf „Weiter“, um fortzufahren."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "${APP} jetzt starten (mit Tutorial)"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\release\${SRC}\*.*"
  CreateDirectory "$INSTDIR\Projekte"
  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APP}\${APP} deinstallieren.lnk" "$INSTDIR\Deinstallieren.exe"
  WriteRegStr HKCU "Software\Lumora" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Deinstallieren.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ; Dateizuordnung .lumora
  WriteRegStr HKCU "Software\Classes\.lumora" "" "Lumora.Projekt"
  WriteRegStr HKCU "Software\Classes\Lumora.Projekt" "" "Lumora Projekt"
  WriteRegStr HKCU "Software\Classes\Lumora.Projekt\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "Software\Classes\Lumora.Projekt\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  ; Programmdateien entfernen, Projekte-Ordner bleibt erhalten
  Delete "$INSTDIR\*.*"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "Software\Lumora"
  DeleteRegKey HKCU "Software\Classes\Lumora.Projekt"
  DeleteRegKey HKCU "Software\Classes\.lumora"
SectionEnd
