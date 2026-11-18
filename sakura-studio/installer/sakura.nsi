; Sakura Studio – Installer (installiert standardmäßig nach Desktop\Sakura Studio)
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"

!define APP "Sakura Studio"
!define VER "1.1.0"
!define EXE "Sakura Studio.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SakuraStudio"

Name "${APP}"
OutFile "..\release\Sakura-Studio-Setup-${VER}.exe"
InstallDir "$DESKTOP\${APP}"
InstallDirRegKey HKCU "Software\SakuraStudio" "InstallDir"
RequestExecutionLevel user
BrandingText "${APP} ${VER}"

VIProductVersion "1.1.0.0"
VIAddVersionKey /LANG=1031 "ProductName" "${APP}"
VIAddVersionKey /LANG=1031 "FileDescription" "${APP} Setup"
VIAddVersionKey /LANG=1031 "FileVersion" "${VER}"
VIAddVersionKey /LANG=1031 "LegalCopyright" "© 2026 ${APP}"

!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "wizard.bmp"
!define MUI_WELCOMEPAGE_TITLE "Willkommen bei ${APP}"
!define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert ${APP} – deine eigene Bildbearbeitung im Sakura-Design.$\r$\n$\r$\nStandardmäßig wird ein neuer Ordner „${APP}“ auf deinem Desktop angelegt. Darin liegen das Programm (${EXE}) und der Unterordner „Projekte“ für deine Arbeiten.$\r$\n$\r$\nKlicke auf „Weiter“, um fortzufahren."
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
  File /r "..\release\win-unpacked\*.*"
  CreateDirectory "$INSTDIR\Projekte"
  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APP}\${APP} deinstallieren.lnk" "$INSTDIR\Deinstallieren.exe"
  WriteRegStr HKCU "Software\SakuraStudio" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Deinstallieren.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ; Dateizuordnung .sakura
  WriteRegStr HKCU "Software\Classes\.sakura" "" "SakuraStudio.Projekt"
  WriteRegStr HKCU "Software\Classes\SakuraStudio.Projekt" "" "Sakura Studio Projekt"
  WriteRegStr HKCU "Software\Classes\SakuraStudio.Projekt\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "Software\Classes\SakuraStudio.Projekt\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
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
  DeleteRegKey HKCU "Software\SakuraStudio"
  DeleteRegKey HKCU "Software\Classes\SakuraStudio.Projekt"
  DeleteRegKey HKCU "Software\Classes\.sakura"
SectionEnd
