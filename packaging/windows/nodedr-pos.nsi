; NodeDR POS - Windows installer
;
; Compiled by packaging\windows\build-windows.ps1, which passes in VERSION,
; STAGE_DIR (the assembled payload), OUT_FILE and the two ports.
;
; Installs the app under Program Files, registers two Windows services via
; WinSW so the POS starts at boot without anyone logging in, opens the web
; port on the firewall (and explicitly blocks the internal API port), and
; creates Start Menu / Desktop shortcuts that open the register.

Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef FRONTEND_PORT
  !define FRONTEND_PORT "1994"
!endif
!ifndef BACKEND_PORT
  !define BACKEND_PORT "4000"
!endif

!define APP_NAME     "NodeDR POS"
!define APP_PUBLISHER "NODEDR INFOTECH PRIVATE LIMITED"
!define APP_URL      "https://pos.nodedr.com/"
; No spaces in the install or data directory on purpose: these paths end up in
; a SQLite connection URL, service arguments and batch scripts, where spaces
; are a recurring source of quoting bugs.
!define INSTALL_DIR_NAME "NodeDRPOS"
!define DATA_DIR     "C:\ProgramData\NodeDRPOS"
!define SVC_BACKEND  "NodeDRPOSBackend"
!define SVC_FRONTEND "NodeDRPOSFrontend"
!define REG_UNINST   "Software\Microsoft\Windows\CurrentVersion\Uninstall\NodeDRPOS"

Name "${APP_NAME} ${VERSION}"
OutFile "${OUT_FILE}"
InstallDir "$PROGRAMFILES64\${INSTALL_DIR_NAME}"
InstallDirRegKey HKLM "Software\${INSTALL_DIR_NAME}" "InstallDir"
; Services, Program Files and firewall rules all need elevation.
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} installer"
VIAddVersionKey "FileVersion"     "${VERSION}"
VIAddVersionKey "ProductVersion"  "${VERSION}"
VIAddVersionKey "LegalCopyright"  "AGPL-3.0 licensed"

!define MUI_ABORTWARNING
!if /FileExists "${STAGE_DIR}\nodedr-pos.ico"
  !define MUI_ICON   "${STAGE_DIR}\nodedr-pos.ico"
  !define MUI_UNICON "${STAGE_DIR}\nodedr-pos.ico"
!endif

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

; Exec cannot launch a .cmd directly, so open the URL via the shell instead.
; The services are already running by the time this page is reached.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchPOS
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP_NAME} now"
!define MUI_FINISHPAGE_LINK "${APP_URL}"
!define MUI_FINISHPAGE_LINK_LOCATION "${APP_URL}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function LaunchPOS
  ExecShell "open" "http://localhost:${FRONTEND_PORT}"
FunctionEnd

; ---------------------------------------------------------------------------
; Helpers
; ---------------------------------------------------------------------------

; Stop and delete both services if a previous version left them behind.
!macro RemoveServices UN
Function ${UN}RemoveServices
  DetailPrint "Stopping ${APP_NAME} services..."
  nsExec::ExecToLog 'net stop "${SVC_FRONTEND}"'
  Pop $0
  nsExec::ExecToLog 'net stop "${SVC_BACKEND}"'
  Pop $0
  ; Uninstall through WinSW itself so it cleans up its own registry state,
  ; falling back to sc.exe when the executable is already gone.
  ${If} ${FileExists} "$INSTDIR\service\nodedr-pos-frontend.exe"
    nsExec::ExecToLog '"$INSTDIR\service\nodedr-pos-frontend.exe" uninstall'
    Pop $0
  ${Else}
    nsExec::ExecToLog 'sc delete "${SVC_FRONTEND}"'
    Pop $0
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\service\nodedr-pos-backend.exe"
    nsExec::ExecToLog '"$INSTDIR\service\nodedr-pos-backend.exe" uninstall'
    Pop $0
  ${Else}
    nsExec::ExecToLog 'sc delete "${SVC_BACKEND}"'
    Pop $0
  ${EndIf}
  ; Windows keeps a deleted service around until every handle closes; give the
  ; SCM a moment so a reinstall in the same run does not fail with 1072.
  Sleep 2000
FunctionEnd
!macroend
!insertmacro RemoveServices ""
!insertmacro RemoveServices "un."

; ---------------------------------------------------------------------------
; Install
; ---------------------------------------------------------------------------
Section "NodeDR POS" SecMain
  SectionIn RO

  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APP_NAME} requires 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}

  ; An upgrade over a running install must not try to overwrite files that are
  ; locked by the running node.exe processes.
  Call RemoveServices

  SetOutPath "$INSTDIR"
  SetOverwrite on
  ; "\*" not "\*.*" — the latter skips extensionless files, and
  ; node_modules is full of them (LICENSE, .bin shims, ...).
  File /r "${STAGE_DIR}\*"

  ; --- Data directory -----------------------------------------------------
  ; Lives outside Program Files so it survives uninstall and is not subject to
  ; installer overwrite. This is the shop's database.
  CreateDirectory "${DATA_DIR}"
  CreateDirectory "${DATA_DIR}\logs"
  CreateDirectory "${DATA_DIR}\backups"

  ; backend\src\lib\secret.js writes the JWT signing secret to <backend>\..\data,
  ; a path relative to the source file that cannot be configured by environment.
  ; A junction redirects it (and anything else resolving through data\) into the
  ; data directory without patching upstream code - same trick as the symlink in
  ; the Debian package.
  ${If} ${FileExists} "$INSTDIR\backend\data\*.*"
    RMDir /r "$INSTDIR\backend\data"
  ${EndIf}
  nsExec::ExecToLog 'cmd /c mklink /J "$INSTDIR\backend\data" "${DATA_DIR}"'
  Pop $0

  ; Next.js writes its incremental cache under .next\cache; keep that out of
  ; Program Files too.
  CreateDirectory "${DATA_DIR}\cache"
  ${If} ${FileExists} "$INSTDIR\frontend\.next\cache\*.*"
    RMDir /r "$INSTDIR\frontend\.next\cache"
  ${EndIf}
  nsExec::ExecToLog 'cmd /c mklink /J "$INSTDIR\frontend\.next\cache" "${DATA_DIR}\cache"'
  Pop $0

  ; --- Database schema ----------------------------------------------------
  ; Idempotent: `migrate deploy` applies only migrations not already recorded,
  ; so this is both the first-install create and the upgrade path.
  DetailPrint "Setting up the database..."
  nsExec::ExecToLog 'cmd /c cd /d "$INSTDIR\backend" && set "DATABASE_URL=file:C:/ProgramData/NodeDRPOS/pos.db" && set "CHECKPOINT_DISABLE=1" && "$INSTDIR\runtime\node.exe" "$INSTDIR\backend\node_modules\prisma\build\index.js" migrate deploy'
  Pop $0
  ${If} $0 != 0
    DetailPrint "WARNING: database migration returned $0."
    MessageBox MB_ICONEXCLAMATION|MB_OK "The database could not be prepared (code $0).$\r$\n$\r$\nThe POS is installed but may not start. Run this to see the error:$\r$\n  $\"$INSTDIR\bin\nodedr-pos.cmd$\" doctor" /SD IDOK
  ${EndIf}

  ; --- Services -----------------------------------------------------------
  DetailPrint "Registering Windows services..."
  nsExec::ExecToLog '"$INSTDIR\service\nodedr-pos-backend.exe" install'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Could not register the ${APP_NAME} API service (code $0)." /SD IDOK
    Abort
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\service\nodedr-pos-frontend.exe" install'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Could not register the ${APP_NAME} web service (code $0)." /SD IDOK
    Abort
  ${EndIf}

  ; --- Firewall -----------------------------------------------------------
  ; Windows denies inbound by default, so the web port needs an explicit allow
  ; for counter tablets and phones on the shop LAN. The API port gets an
  ; explicit block as defence in depth - it is only ever reached over loopback
  ; by the web server's /api proxy, never from another machine.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NodeDR POS Web"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NodeDR POS Web" dir=in action=allow protocol=TCP localport=${FRONTEND_PORT} profile=private,domain'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NodeDR POS API (internal only)"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="NodeDR POS API (internal only)" dir=in action=block protocol=TCP localport=${BACKEND_PORT}'
  Pop $0

  DetailPrint "Starting ${APP_NAME}..."
  nsExec::ExecToLog 'net start "${SVC_BACKEND}"'
  Pop $0
  nsExec::ExecToLog 'net start "${SVC_FRONTEND}"'
  Pop $0

  ; --- Shortcuts ----------------------------------------------------------
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\bin\nodedr-pos.cmd" "open" "$INSTDIR\nodedr-pos.ico" 0 SW_SHOWMINIMIZED
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Check ${APP_NAME}.lnk" "$INSTDIR\bin\nodedr-pos.cmd" "doctor" "$INSTDIR\nodedr-pos.ico"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\bin\nodedr-pos.cmd" "open" "$INSTDIR\nodedr-pos.ico" 0 SW_SHOWMINIMIZED

  ; --- Registry / Add-Remove Programs -------------------------------------
  WriteRegStr HKLM "Software\${INSTALL_DIR_NAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\${INSTALL_DIR_NAME}" "Version"    "${VERSION}"
  WriteRegStr HKLM "${REG_UNINST}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKLM "${REG_UNINST}" "DisplayVersion"  "${VERSION}"
  WriteRegStr HKLM "${REG_UNINST}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKLM "${REG_UNINST}" "URLInfoAbout"    "${APP_URL}"
  WriteRegStr HKLM "${REG_UNINST}" "DisplayIcon"     "$INSTDIR\nodedr-pos.ico"
  WriteRegStr HKLM "${REG_UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${REG_UNINST}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${REG_UNINST}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKLM "${REG_UNINST}" "NoModify" 1
  WriteRegDWORD HKLM "${REG_UNINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${REG_UNINST}" "EstimatedSize" "$0"

  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; ---------------------------------------------------------------------------
; Uninstall
; ---------------------------------------------------------------------------
Section "Uninstall"
  Call un.RemoveServices

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NodeDR POS Web"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NodeDR POS API (internal only)"'
  Pop $0

  ; Remove the junctions before the tree, so RMDir never follows them into the
  ; data directory and deletes the shop's database.
  nsExec::ExecToLog 'cmd /c rmdir "$INSTDIR\backend\data"'
  Pop $0
  nsExec::ExecToLog 'cmd /c rmdir "$INSTDIR\frontend\.next\cache"'
  Pop $0

  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKLM "${REG_UNINST}"
  DeleteRegKey HKLM "Software\${INSTALL_DIR_NAME}"

  ; The database is deliberately NOT removed: uninstalling to reinstall a newer
  ; build must never wipe a shop's sales history. Offer it explicitly instead,
  ; and never in silent mode.
  IfSilent keep_shop_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Also delete all shop data?$\r$\n$\r$\nThis permanently removes the database, sales history, customers and settings in:$\r$\n${DATA_DIR}$\r$\n$\r$\nChoose No to keep your data for a future reinstall." \
    /SD IDNO IDNO keep_shop_data
  RMDir /r "${DATA_DIR}"
  DetailPrint "Shop data removed."
  keep_shop_data:
SectionEnd
