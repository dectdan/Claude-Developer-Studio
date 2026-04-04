; ClaudeDevStudio Setup -- NSIS Installer Script
; Single-EXE installer: downloads .NET 8 + Node.js if missing,
; installs all components, bundles Kokoro model, auto-configures Claude Desktop.
;
; Build: makensis setup.nsi   (run from Installer\ directory via build-setup.ps1)
; Output: Output\ClaudeDevStudio-Setup.exe

Unicode True
SetCompressor /SOLID lzma

;---------------------------------------------------------------------------
; Metadata
;---------------------------------------------------------------------------
!define PRODUCT_NAME      "ClaudeDevStudio"
!define PRODUCT_VERSION   "1.1.0"
!define PRODUCT_PUBLISHER "Daniel E Gain"
!define PRODUCT_URL       "https://github.com/dectdan/Claude-Developer-Studio"
!define INSTALL_DIR       "$LocalAppData\ClaudeDevStudio"
!define MCP_INDEX         "$LocalAppData\ClaudeDevStudio\mcp-server\index.js"
!define VOICE_DIR         "$LocalAppData\ClaudeDevStudio\VoiceServer"
!define UNINSTALL_KEY     "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClaudeDevStudio"

;---------------------------------------------------------------------------
; Includes
;---------------------------------------------------------------------------
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WordFunc.nsh"
!include "WinMessages.nsh"

;---------------------------------------------------------------------------
; MUI Settings
;---------------------------------------------------------------------------
!define MUI_ABORTWARNING
!ifdef HAVE_ICON
  !define MUI_ICON   "Assets\AppIcon.ico"
  !define MUI_UNICON "Assets\AppIcon.ico"
!endif
!define MUI_WELCOMEPAGE_TITLE  "Install ClaudeDevStudio v${PRODUCT_VERSION}"
!define MUI_WELCOMEPAGE_TEXT   "ClaudeDevStudio gives Claude AI persistent memory, voice alerts, and live Visual Studio integration.$\r$\n$\r$\nThis installer will:$\r$\n  - Install all required components$\r$\n  - Download .NET 8 and Node.js if needed$\r$\n  - Auto-configure Claude Desktop$\r$\n$\r$\nClick Install to continue."
!define MUI_FINISHPAGE_TITLE   "ClaudeDevStudio Installed!"
!define MUI_FINISHPAGE_TEXT    "Installation complete.$\r$\n$\r$\nRestart Claude Desktop to activate.$\r$\n$\r$\nThe ClaudeDevStudio tray icon will appear in your system tray."
!define MUI_FINISHPAGE_RUN          "$LocalAppData\ClaudeDevStudio\TrayApp\ClaudeDevStudio.TrayApp.exe"
!define MUI_FINISHPAGE_RUN_TEXT     "Start ClaudeDevStudio now"
!define MUI_FINISHPAGE_LINK         "View on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_URL}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

;---------------------------------------------------------------------------
; Installer attributes
;---------------------------------------------------------------------------
Name              "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile           "Output\ClaudeDevStudio-Setup.exe"
InstallDir        "${INSTALL_DIR}"
RequestExecutionLevel admin
ShowInstDetails   show

;---------------------------------------------------------------------------
; Section: Main Install
;---------------------------------------------------------------------------
Section "Install" SecMain

  SetOutPath "${INSTALL_DIR}"
  SetOverwrite on

  ;--- Step 0: Stop running CDS processes so files aren't locked ---
  DetailPrint "Stopping any running ClaudeDevStudio processes..."
  nsExec::ExecToLog 'taskkill /IM ClaudeDevStudio.TrayApp.exe /F'
  nsExec::ExecToLog 'taskkill /IM VoiceServer.exe /F'
  nsExec::ExecToLog 'taskkill /IM claudedev.exe /F'
  ; Kill review-server (node process on port 63000)
  nsExec::ExecToLog 'cmd /c for /f "tokens=5" %a in (''netstat -ano ^| findstr :63000'') do taskkill /PID %a /F'
  Sleep 1000

  ;--- Step 1: Check .NET 8 via registry, download if missing ---
  DetailPrint "Checking .NET 8 Runtime..."
  ReadRegStr $0 HKLM "SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.NETCore.App" "8.0.0"
  StrCmp $0 "" 0 DotNetDone
    ; Not found via registry - also try running dotnet
    nsExec::ExecToStack 'cmd /c dotnet --list-runtimes 2>&1 | findstr /C:"Microsoft.NETCore.App 8."'
    Pop $0
    Pop $1
    IntCmp $0 0 DotNetDone DotNetDone DownloadDotNet
  DownloadDotNet:
    DetailPrint "Downloading .NET 8 Runtime (~60 MB)..."
    ExecWait 'powershell -NoProfile -Command "(New-Object Net.WebClient).DownloadFile(\"https://aka.ms/dotnet/8.0/dotnet-runtime-win-x64.exe\",\"$TEMP\dotnet8.exe\")"' $0
    ${If} $0 == 0
      DetailPrint "Installing .NET 8 silently..."
      ExecWait '"$TEMP\dotnet8.exe" /quiet /norestart'
      Delete "$TEMP\dotnet8.exe"
    ${Else}
      MessageBox MB_ICONEXCLAMATION "Could not download .NET 8.$\r$\nInstall from: https://dotnet.microsoft.com/download/dotnet/8.0"
    ${EndIf}
  DotNetDone:
  DetailPrint ".NET 8 check done."

  ;--- Step 2: Install bundled Node.js if not already present ---
  DetailPrint "Checking Node.js..."
  StrCpy $0 ""
  ${If} ${FileExists} "$PROGRAMFILES64\nodejs\node.exe"
    StrCpy $0 "$PROGRAMFILES64\nodejs\node.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES\nodejs\node.exe"
    StrCpy $0 "$PROGRAMFILES\nodejs\node.exe"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Programs\nodejs\node.exe"
    StrCpy $0 "$LOCALAPPDATA\Programs\nodejs\node.exe"
  ${EndIf}

  ${If} $0 != ""
    DetailPrint "Node.js found at $0. Skipping install."
  ${Else}
    DetailPrint "Installing bundled Node.js LTS..."
    ; Extract the bundled MSI to temp and run it silently
    SetOutPath "$TEMP"
    File "build\node-lts-x64.msi"
    ExecWait 'msiexec /i "$TEMP\node-lts-x64.msi" /quiet /norestart' $0
    Delete "$TEMP\node-lts-x64.msi"
    ${If} $0 == 0
      DetailPrint "Node.js installed successfully."
    ${Else}
      DetailPrint "Node.js install returned code $0 -- may already be present."
    ${EndIf}
  ${EndIf}

  ;--- Step 3: Install bundled Windows App Runtime 1.8 (required for WinUI 3 Dashboard) ---
  DetailPrint "Checking Windows App Runtime..."
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\WindowsAppRuntime\1.8" ""
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\WindowsAppRuntime\1.6" ""
  ${If} $0 != ""
    DetailPrint "Windows App Runtime 1.8 already installed."
  ${ElseIf} $1 != ""
    DetailPrint "Windows App Runtime 1.6 found -- installing 1.8..."
    SetOutPath "$TEMP"
    File "build\WinAppRuntime.exe"
    ExecWait '"$TEMP\WinAppRuntime.exe" --quiet' $0
    Delete "$TEMP\WinAppRuntime.exe"
    DetailPrint "Windows App Runtime 1.8 installed."
  ${Else}
    DetailPrint "Installing bundled Windows App Runtime 1.8..."
    SetOutPath "$TEMP"
    File "build\WinAppRuntime.exe"
    ExecWait '"$TEMP\WinAppRuntime.exe" --quiet' $0
    Delete "$TEMP\WinAppRuntime.exe"
    ${If} $0 == 0
      DetailPrint "Windows App Runtime installed successfully."
    ${Else}
      DetailPrint "Windows App Runtime install returned code $0."
    ${EndIf}
  ${EndIf}

  ;--- Step 3b: Install CDS application files ---
  DetailPrint "Installing ClaudeDevStudio files..."

  SetOutPath "${INSTALL_DIR}\CLI"
  File /nonfatal /r "build\CLI\*.*"

  SetOutPath "${INSTALL_DIR}\TrayApp"
  File /nonfatal /r "build\TrayApp\*.*"

  SetOutPath "${INSTALL_DIR}\Dashboard"
  File /nonfatal /r "build\Dashboard\*.*"

  SetOutPath "${INSTALL_DIR}\mcp-server"
  File /nonfatal /r "build\mcp-server\*.*"

  SetOutPath "${INSTALL_DIR}\VoiceServer"
  File /nonfatal /r "build\VoiceServer\*.*"

  SetOutPath "${INSTALL_DIR}\review-server"
  File /nonfatal /r "build\review-server\*.*"

  SetOutPath "${INSTALL_DIR}\VSExtension"
  File /nonfatal "build\VSExtension\CdsVsBridge.vsix"

  SetOutPath "${INSTALL_DIR}"
  File /nonfatal "build\ConfigureClaudeDesktop.ps1"

  ;--- Step 4: npm install (only if node_modules wasn't bundled) ---
  ${IfNot} ${FileExists} "${INSTALL_DIR}\mcp-server\node_modules\*.*"
    DetailPrint "Installing MCP server dependencies..."
    nsExec::ExecToLog 'cmd /c cd /d "${INSTALL_DIR}\mcp-server" && npm install --production 2>&1'
  ${Else}
    DetailPrint "MCP dependencies already bundled. Skipping npm install."
  ${EndIf}

  ;--- Step 5: Download Kokoro model if not bundled ---
  DetailPrint "Checking voice model..."
  ${IfNot} ${FileExists} "${INSTALL_DIR}\VoiceServer\kokoro.onnx"
    DetailPrint "Downloading Kokoro voice model (~310 MB)..."
    ExecWait 'powershell -NoProfile -Command "(New-Object Net.WebClient).DownloadFile(\"https://github.com/taylorchu/kokoro-onnx/releases/download/v0.2.0/kokoro.onnx\",\"${INSTALL_DIR}\VoiceServer\kokoro.onnx\")"' $0
    ${If} $0 == 0
      DetailPrint "Voice model downloaded."
    ${Else}
      DetailPrint "Voice model download failed -- voice disabled until retried."
    ${EndIf}
  ${Else}
    DetailPrint "Voice model present."
  ${EndIf}

  ;--- Step 6: Install VSIX into Visual Studio if detected ---
  ; VS 2022 doesn't reliably write to the old COM registry key.
  ; Instead we check known install paths for all three editions.
  DetailPrint "Checking for Visual Studio 2022..."
  StrCpy $0 ""

  ${If} ${FileExists} "$PROGRAMFILES64\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\VSIXInstaller.exe"
    StrCpy $0 "$PROGRAMFILES64\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\VSIXInstaller.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft Visual Studio\2022\Professional\Common7\IDE\VSIXInstaller.exe"
    StrCpy $0 "$PROGRAMFILES64\Microsoft Visual Studio\2022\Professional\Common7\IDE\VSIXInstaller.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft Visual Studio\2022\Community\Common7\IDE\VSIXInstaller.exe"
    StrCpy $0 "$PROGRAMFILES64\Microsoft Visual Studio\2022\Community\Common7\IDE\VSIXInstaller.exe"
  ${EndIf}

  ${If} $0 != ""
    DetailPrint "Found VS 2022. Installing VS Bridge extension..."
    ; /quiet suppresses the VSIX UI; result is non-zero only on hard failure
    nsExec::ExecToLog '"$0" /quiet "${INSTALL_DIR}\VSExtension\CdsVsBridge.vsix"'
    DetailPrint "VS Bridge extension installed."
  ${Else}
    DetailPrint "Visual Studio 2022 not found -- VS Bridge skipped (optional)."
  ${EndIf}

  ;--- Step 7: Configure Claude Desktop ---
  DetailPrint "Configuring Claude Desktop..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -File "${INSTALL_DIR}\ConfigureClaudeDesktop.ps1" -MCPServerPath "${MCP_INDEX}"'

  ;--- Step 8: Create data directories ---
  CreateDirectory "$DOCUMENTS\ClaudeDevStudio\Projects"
  CreateDirectory "$DOCUMENTS\ClaudeDevStudio\Backups"
  CreateDirectory "$APPDATA\Claude"

  ;--- Step 9: Registry, shortcuts, autostart ---
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName"     "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher"       "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout"    "${PRODUCT_URL}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "${INSTALL_DIR}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"${INSTALL_DIR}\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair"  1

  ; CDS runtime settings used by TrayApp
  WriteRegStr HKCU "Software\ClaudeDevStudio" "DashboardPath" "${INSTALL_DIR}\Dashboard"
  WriteRegStr HKCU "Software\ClaudeDevStudio" "InstallDir"    "${INSTALL_DIR}"
  WriteRegStr HKCU "Software\ClaudeDevStudio" "Version"       "${PRODUCT_VERSION}"

  ; Add CLI to user PATH so 'claudedev' works from any terminal
  ReadRegStr $0 HKCU "Environment" "PATH"
  ${If} $0 != ""
    StrCpy $0 "$0;${INSTALL_DIR}\CLI"
  ${Else}
    StrCpy $0 "${INSTALL_DIR}\CLI"
  ${EndIf}
  WriteRegExpandStr HKCU "Environment" "PATH" "$0"
  ; Broadcast WM_SETTINGCHANGE so open terminals pick it up
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
    "ClaudeDevStudio" '"${INSTALL_DIR}\TrayApp\ClaudeDevStudio.TrayApp.exe"'

  CreateDirectory "$SMPROGRAMS\ClaudeDevStudio"
  CreateShortcut "$SMPROGRAMS\ClaudeDevStudio\ClaudeDevStudio.lnk" \
    "${INSTALL_DIR}\TrayApp\ClaudeDevStudio.TrayApp.exe"
  CreateShortcut "$SMPROGRAMS\ClaudeDevStudio\Uninstall.lnk" \
    "${INSTALL_DIR}\Uninstall.exe"

  WriteUninstaller "${INSTALL_DIR}\Uninstall.exe"
  DetailPrint "Installation complete!"

SectionEnd

;---------------------------------------------------------------------------
; Uninstall Section
;---------------------------------------------------------------------------
Section "Uninstall"

  nsExec::ExecToLog 'taskkill /IM ClaudeDevStudio.TrayApp.exe /F'
  nsExec::ExecToLog 'taskkill /IM VoiceServer.exe /F'

  ;--- Remove VS Bridge extension if VS 2022 is present ---
  StrCpy $0 ""
  ${If} ${FileExists} "$PROGRAMFILES64\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\VSIXInstaller.exe"
    StrCpy $0 "$PROGRAMFILES64\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\VSIXInstaller.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft Visual Studio\2022\Professional\Common7\IDE\VSIXInstaller.exe"
    StrCpy $0 "$PROGRAMFILES64\Microsoft Visual Studio\2022\Professional\Common7\IDE\VSIXInstaller.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft Visual Studio\2022\Community\Common7\IDE\VSIXInstaller.exe"
    StrCpy $0 "$PROGRAMFILES64\Microsoft Visual Studio\2022\Community\Common7\IDE\VSIXInstaller.exe"
  ${EndIf}
  ${If} $0 != ""
    nsExec::ExecToLog '"$0" /quiet /uninstall:CdsVsBridge.DanGain.ClaudeDevStudio'
  ${EndIf}

  RMDir /r "${INSTALL_DIR}\CLI"
  RMDir /r "${INSTALL_DIR}\TrayApp"
  RMDir /r "${INSTALL_DIR}\Dashboard"
  RMDir /r "${INSTALL_DIR}\mcp-server"
  RMDir /r "${INSTALL_DIR}\VoiceServer"
  RMDir /r "${INSTALL_DIR}\review-server"
  RMDir /r "${INSTALL_DIR}\VSExtension"
  Delete   "${INSTALL_DIR}\ConfigureClaudeDesktop.ps1"
  Delete   "${INSTALL_DIR}\Uninstall.exe"
  RMDir    "${INSTALL_DIR}"

  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ClaudeDevStudio"
  DeleteRegKey   HKCU "${UNINSTALL_KEY}"

  ; Remove CLI from user PATH
  ReadRegStr $0 HKCU "Environment" "PATH"
  ${WordReplace} "$0" "${INSTALL_DIR}\CLI;" "" "+" $0
  ${WordReplace} "$0" ";${INSTALL_DIR}\CLI" "" "+" $0
  WriteRegExpandStr HKCU "Environment" "PATH" "$0"

  Delete "$SMPROGRAMS\ClaudeDevStudio\ClaudeDevStudio.lnk"
  Delete "$SMPROGRAMS\ClaudeDevStudio\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\ClaudeDevStudio"

  MessageBox MB_ICONINFORMATION "ClaudeDevStudio uninstalled.$\r$\nYour data in Documents\ClaudeDevStudio has been kept."

SectionEnd
