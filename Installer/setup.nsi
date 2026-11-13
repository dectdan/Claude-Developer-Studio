; ClaudeDevStudio Setup -- NSIS Installer Script
; Build: makensis setup.nsi   (run from Installer\ directory via build-setup.ps1)
; Output: Output\ClaudeDevStudio-Setup.exe
; Silent: ClaudeDevStudio-Setup.exe /S    Uninstall.exe /S
;
; What the user owns is never overwritten (docs\GROUND_TRUTH.md section 7, items 14-16):
; - claude_desktop_config.json: cds-config.js (run with Node) adds or removes only CDS's two
;   entries, backs the file up first, and leaves a file that isn't valid JSON untouched;
; - mcp-server\qwen_config.json (the user's API keys): created from the template only when
;   it doesn't exist; no step writes over it;
; - the user PATH: cds-path.ps1 adds or removes only CDS's CLI folder (NSIS strings are
;   1024 characters, too short to read and rewrite a long PATH safely);
; - the TrayApp auto-start entry is written on a first install only.
;
; Claude Code (from v1.6.0, P9: Dan's "the Claude Code integration is a core feature"): the
; installer looks for Claude Code (cds-claude-code.js detect: where claude, then
; %USERPROFILE%\.local\bin\claude.exe, and its version). Found and 2.1 or later: the finish page's
; "Also set up Claude Code" box is ticked (still visible; the user can untick it), and a silent
; install sets it up unless given /CLAUDECODE=0. Not found (or too old): the box is hidden and the
; finish text says how to get it and that the tray app can set it up later. /CLAUDECODE=1 sets it
; up whatever was found (as before). A user who removed the setup (tray app or claudedev
; claude-code remove: claude-code-declined.txt) gets the box unticked and no silent setup.
; An install where it is already set up refreshes its paths (setup --if-set-up never turns it on).
; The uninstaller takes out only CDS's entries.
;   ClaudeDevStudio-Setup.exe /S                  (sets up Claude Code if it is there)
;   ClaudeDevStudio-Setup.exe /S /CLAUDECODE=0    (doesn't)

Unicode True
SetCompressor /SOLID lzma

;---------------------------------------------------------------------------
; Metadata
;---------------------------------------------------------------------------
!define PRODUCT_NAME      "ClaudeDevStudio"
!define PRODUCT_VERSION   "1.7.3"
!define PRODUCT_PUBLISHER "Daniel E Gain"
!define PRODUCT_CONTACT   "support@gainpublications.com"
!define PRODUCT_URL       "https://github.com/dectdan/Claude-Developer-Studio"
!define INSTALL_DIR       "$LocalAppData\ClaudeDevStudio"
!define UNINSTALL_KEY     "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClaudeDevStudio"
!define CLAUDE_CONFIG     "$APPDATA\Claude\claude_desktop_config.json"
!define MANUAL_FILE       "ADD-TO-CLAUDE-CONFIG.txt"
!define POWERSHELL        "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"

;---------------------------------------------------------------------------
; Includes
;---------------------------------------------------------------------------
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinMessages.nsh"
!include "FileFunc.nsh"

Var NodeExe       ; full path to node.exe, or "" when there is none
Var FinishText    ; the finish page text (set at the end of the install)
Var NoClaudeDesktop ; "1" when Claude Desktop was never set up on this account (P5)
Var ClaudeCode    ; "1" when /CLAUDECODE=1 was given, "0" for /CLAUDECODE=0
Var CCFound       ; Claude Code: "ok" (2.1 or later), "old", "none" (cds-claude-code.js detect)
Var CCLine        ; the finish text's Claude Code sentence

;---------------------------------------------------------------------------
; MUI Settings
;---------------------------------------------------------------------------
!define MUI_ABORTWARNING
!ifdef HAVE_ICON
  !define MUI_ICON   "Assets\AppIcon.ico"
  !define MUI_UNICON "Assets\AppIcon.ico"
!endif
!define MUI_WELCOMEPAGE_TITLE  "Install ClaudeDevStudio v${PRODUCT_VERSION}"
!define MUI_WELCOMEPAGE_TEXT   "ClaudeDevStudio gives Claude persistent memory of your projects, plus developer tools, in Claude Desktop.$\r$\n$\r$\nThis installer will:$\r$\n  - Install ClaudeDevStudio and the runtimes it needs$\r$\n  - Add its two servers to Claude Desktop's settings (your other servers and settings are kept)$\r$\n$\r$\nClick Install to continue."
!define MUI_FINISHPAGE_TITLE   "ClaudeDevStudio Installed"
!define MUI_FINISHPAGE_TEXT    "$FinishText"
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_RUN          "$LocalAppData\ClaudeDevStudio\TrayApp\ClaudeDevStudio.TrayApp.exe"
!define MUI_FINISHPAGE_RUN_TEXT     "Start ClaudeDevStudio now"
; The installer runs elevated; the tray app must not, so Explorer (the user's own, un-elevated
; shell) starts it.
!define MUI_FINISHPAGE_RUN_FUNCTION StartTrayAppUnelevated
; The second box: Claude Code, ticked when Claude Code was found (FinishPageShow hides or unticks it).
!define MUI_FINISHPAGE_SHOWREADME          ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT     "Also set up Claude Code (recommended; undo any time)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION FinishClaudeCodeSetup
!define MUI_FINISHPAGE_LINK         "View on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_URL}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishPageShow
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
ShowUninstDetails show

;---------------------------------------------------------------------------
; Node.js lookup (the same places for install and uninstall)
;---------------------------------------------------------------------------
!macro FIND_NODE
  StrCpy $NodeExe ""
  ${If} ${FileExists} "$PROGRAMFILES64\nodejs\node.exe"
    StrCpy $NodeExe "$PROGRAMFILES64\nodejs\node.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES\nodejs\node.exe"
    StrCpy $NodeExe "$PROGRAMFILES\nodejs\node.exe"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Programs\nodejs\node.exe"
    StrCpy $NodeExe "$LOCALAPPDATA\Programs\nodejs\node.exe"
  ${EndIf}
!macroend

Function FindNode
  !insertmacro FIND_NODE
FunctionEnd

Function un.FindNode
  !insertmacro FIND_NODE
FunctionEnd

Function .onInit
  StrCpy $ClaudeCode ""
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/CLAUDECODE=" $R1
  ${IfNot} ${Errors}
    StrCpy $ClaudeCode $R1
  ${EndIf}
FunctionEnd

Function StartTrayAppUnelevated
  Exec '"$WINDIR\explorer.exe" "${INSTALL_DIR}\TrayApp\ClaudeDevStudio.TrayApp.exe"'
FunctionEnd

; Claude Code setup (cds-claude-code.js, run with Node). Result in install.log; never fails the install.
Function RunClaudeCodeSetup
  ${If} $NodeExe == ""
  ${OrIfNot} ${FileExists} "${INSTALL_DIR}\cds-claude-code.js"
    StrCpy $0 "nonode"
    Return
  ${EndIf}
  nsExec::ExecToLog '"$NodeExe" "${INSTALL_DIR}\cds-claude-code.js" setup --node "$NodeExe" --mcp "${INSTALL_DIR}\mcp-server" --log "${INSTALL_DIR}\install.log"'
  Pop $0
FunctionEnd

; The finish page: the Claude Code box only when Claude Code (2.1 or later) was found, ticked unless
; the user removed the setup before.
Function FinishPageShow
  ${If} $CCFound != "ok"
  ${OrIf} $ClaudeCode == "1"
  ${OrIf} $ClaudeCode == "0"
    ; Not there (the finish text says how to get it), or already set up by /CLAUDECODE=1.
    ShowWindow $mui.FinishPage.ShowReadme ${SW_HIDE}
    SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} 0 0
  ${ElseIf} ${FileExists} "${INSTALL_DIR}\claude-code-declined.txt"
    SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} 0 0
  ${EndIf}
FunctionEnd

; The finish page's "Also set up Claude Code" box.
Function FinishClaudeCodeSetup
  Call RunClaudeCodeSetup
  ${If} $0 == "0"
    MessageBox MB_ICONINFORMATION "Claude Code is set up for ClaudeDevStudio. New Claude Code sessions load the project's memory at the start.$\r$\n$\r$\nTo undo: the tray app's $\"Remove from Claude Code$\", or claudedev claude-code remove.$\r$\nDetails: ${INSTALL_DIR}\install.log" /SD IDOK
  ${ElseIf} $0 == "nonode"
    MessageBox MB_ICONEXCLAMATION "Claude Code was not set up: Node.js was not found. Install Node.js LTS, then run: claudedev claude-code setup" /SD IDOK
  ${Else}
    MessageBox MB_ICONEXCLAMATION "Claude Code was not set up (code $0); nothing in its settings was changed if a file was not valid JSON.$\r$\nDetails: ${INSTALL_DIR}\install.log" /SD IDOK
  ${EndIf}
FunctionEnd

; install.log is UTF-8 throughout (P11). The Node scripts, the PowerShell scripts and the CLI
; (--log) append their own lines in UTF-8; the installer's lines are converted here, since NSIS's
; FileWrite writes the ANSI code page. No program's output is read back into the log through nsExec:
; nsExec decodes it in the ANSI code page (the "û" for a check mark on a Windows 10 PC, v1.7.0).
Function LogUtf8
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  CreateDirectory "${INSTALL_DIR}"
  FileOpen $R1 "${INSTALL_DIR}\install.log" a
  ${If} $R1 != ""
    FileSeek $R1 0 END
    System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w R0, i -1, p 0, i 0, p 0, p 0) i .R2'
    ${If} $R2 > 1
      System::Alloc $R2
      Pop $R3
      System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w R0, i -1, p R3, i R2, p 0, p 0) i .R2'
      IntOp $R2 $R2 - 1
      System::Call 'kernel32::WriteFile(p R1, p R3, i R2, *i 0, p 0)'
      System::Free $R3
    ${EndIf}
    FileClose $R1
  ${EndIf}
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

; Each install step goes to the details list and to install.log (silent installs too).
!macro STEP _text
  DetailPrint "${_text}"
  Push "[setup] ${_text}$\r$\n"
  Call LogUtf8
!macroend
!define STEP "!insertmacro STEP"

;---------------------------------------------------------------------------
; Section: Main Install
;---------------------------------------------------------------------------
Section "Install" SecMain

  SetOutPath "${INSTALL_DIR}"
  SetOverwrite on

  ; An upgrade if a previous version registered itself.
  ReadRegStr $9 HKCU "Software\ClaudeDevStudio" "Version"

  ;--- Step 0: Stop running CDS processes so files aren't locked ---
  ${STEP} "Stopping any running ClaudeDevStudio processes..."
  nsExec::ExecToLog 'taskkill /IM ClaudeDevStudio.TrayApp.exe /F'
  nsExec::ExecToLog 'taskkill /IM claudedev.exe /F'
  ; Kill review-server (node process on port 63000)
  nsExec::ExecToLog 'cmd /c for /f "tokens=5" %a in (''netstat -ano ^| findstr :63000'') do taskkill /PID %a /F'
  Sleep 1000

  ;--- Step 1: .NET 8 Desktop Runtime (CLI, TrayApp and Dashboard; bundled, works offline) ---
  ${STEP} "Checking .NET 8 Desktop Runtime..."
  StrCpy $1 ""
  FindFirst $0 $1 "$PROGRAMFILES64\dotnet\shared\Microsoft.WindowsDesktop.App\8.*"
  FindClose $0
  ${If} $1 != ""
    ${STEP} ".NET 8 Desktop Runtime $1 found."
  ${Else}
    ${STEP} "Installing bundled .NET 8 Desktop Runtime..."
    SetOutPath "$TEMP"
    File "build\windowsdesktop-runtime-8-x64.exe"
    ExecWait '"$TEMP\windowsdesktop-runtime-8-x64.exe" /install /quiet /norestart /log "$TEMP\ClaudeDevStudio-dotnet-install.log"' $0
    Delete "$TEMP\windowsdesktop-runtime-8-x64.exe"
    ${STEP} ".NET 8 Desktop Runtime install done (code $0)."
    ${If} $0 != 0
    ${AndIf} $0 != 3010
      MessageBox MB_ICONEXCLAMATION "The .NET 8 Desktop Runtime could not be installed (code $0).$\r$\nInstall it from https://dotnet.microsoft.com/download/dotnet/8.0" /SD IDOK
    ${EndIf}
  ${EndIf}

  ;--- Step 2: Node.js -- install bundled version if not present ---
  ${STEP} "Checking Node.js..."
  Call FindNode
  ${If} $NodeExe != ""
    ${STEP} "Node.js found at $NodeExe. Skipping install."
  ${Else}
    ${STEP} "Installing bundled Node.js LTS..."
    SetOutPath "$TEMP"
    File "build\node-lts-x64.msi"
    ExecWait 'msiexec /i "$TEMP\node-lts-x64.msi" /quiet /norestart' $0
    Delete "$TEMP\node-lts-x64.msi"
    ${STEP} "Node.js install done (code $0)."
    Call FindNode
    ${If} $NodeExe == ""
      ${STEP} "Node.js is still not found after its install."
    ${EndIf}
  ${EndIf}

  ;--- Step 3: Windows App Runtime 1.8 (required for WinUI 3 Dashboard) ---
  ${STEP} "Checking Windows App Runtime..."
  ; Its installer registers MSIX packages (the Microsoft.WindowsAppRuntime.1.8 framework and
  ; MicrosoftCorporationII.WinAppRuntime.Main.1.8), not a registry key: ask Windows for those.
  ; (Before v1.4.0 this read HKLM\SOFTWARE\Microsoft\WindowsAppRuntime\1.8, which no installer
  ; writes, so the runtime was reinstalled every time.)
  nsExec::ExecToStack `"${POWERSHELL}" -NoProfile -NonInteractive -Command "$$f = Get-AppxPackage -Name Microsoft.WindowsAppRuntime.1.8 | Where-Object { $$_.Architecture -eq 'X64' }; $$m = Get-AppxPackage -Name MicrosoftCorporationII.WinAppRuntime.Main.1.8; if ($$f -and $$m) { exit 0 } else { exit 1 }"`
  Pop $0
  Pop $1
  ${If} $0 == "0"
    ${STEP} "Windows App Runtime 1.8 already installed."
  ${Else}
    ${STEP} "Installing bundled Windows App Runtime 1.8..."
    SetOutPath "$TEMP"
    File "build\WinAppRuntime.exe"
    ExecWait '"$TEMP\WinAppRuntime.exe" --quiet' $0
    Delete "$TEMP\WinAppRuntime.exe"
    ${STEP} "Windows App Runtime install done (code $0)."
  ${EndIf}

  ;--- Step 4: Install CDS application files ---
  ${STEP} "Installing ClaudeDevStudio files..."

  ; CDS already installed (a version in the registry, or an installed CLI): back up the whole memory
  ; store before the upgrade (P10). Done with the new CLI right after it is copied, before anything
  ; runs it against the memory (the files copied here are programs, not memory). Never fails the install.
  StrCpy $7 ""
  ${If} $9 != ""
    StrCpy $7 "upgrade"
  ${ElseIf} ${FileExists} "${INSTALL_DIR}\CLI\claudedev.exe"
    StrCpy $7 "upgrade"
  ${EndIf}

  SetOutPath "${INSTALL_DIR}\CLI"
  File /r "build\CLI\*.*"

  ${If} $7 == "upgrade"
    ${STEP} "Backing up the memory store before the upgrade..."
    ; The CLI writes its own lines (where the backup is, its size) to install.log (--log, UTF-8).
    nsExec::ExecToStack '"${INSTALL_DIR}\CLI\claudedev.exe" backup --upgrade --log "${INSTALL_DIR}\install.log"'
    Pop $0
    Pop $1
    ${STEP} "Memory backup (exit $0); its lines are above."
  ${EndIf}

  SetOutPath "${INSTALL_DIR}\TrayApp"
  File /r "build\TrayApp\*.*"

  SetOutPath "${INSTALL_DIR}\Dashboard"
  File /r "build\Dashboard\*.*"

  ; The staged mcp-server folder holds qwen_config.template.json, never qwen_config.json.
  SetOutPath "${INSTALL_DIR}\mcp-server"
  File /r "build\mcp-server\*.*"

  SetOutPath "${INSTALL_DIR}\review-server"
  File /r "build\review-server\*.*"

  SetOutPath "${INSTALL_DIR}\VSExtension"
  File "build\VSExtension\CdsVsBridge.vsix"

  SetOutPath "${INSTALL_DIR}"
  File "build\cds-config.js"
  File "build\cds-claude-code.js"
  File "build\cds-vsix.ps1"
  File "build\cds-path.ps1"
  ; Scripts from v1.2.x that are no longer used
  Delete "${INSTALL_DIR}\install-extension.ps1"
  Delete "${INSTALL_DIR}\ConfigureClaudeDesktop.ps1"

  ;--- Step 5: The user's API keys file: created once, never overwritten ---
  ${If} ${FileExists} "${INSTALL_DIR}\mcp-server\qwen_config.json"
    ${STEP} "qwen_config.json exists: kept as it is (your API keys)."
  ${Else}
    CopyFiles /SILENT "${INSTALL_DIR}\mcp-server\qwen_config.template.json" "${INSTALL_DIR}\mcp-server\qwen_config.json"
    ${STEP} "qwen_config.json created from the template (no keys)."
  ${EndIf}

  ;--- Step 6: npm install (only if node_modules wasn't bundled) ---
  ${IfNot} ${FileExists} "${INSTALL_DIR}\mcp-server\node_modules\*.*"
    ${STEP} "Installing MCP server dependencies..."
    nsExec::ExecToLog 'cmd /c cd /d "${INSTALL_DIR}\mcp-server" && npm install --production 2>&1'
  ${Else}
    ${STEP} "MCP dependencies already bundled. Skipping npm install."
  ${EndIf}

  ;--- Step 7: VS Bridge into every Visual Studio found by vswhere (never fails the install) ---
  ${STEP} "Installing the VS Bridge into Visual Studio, if any..."
  nsExec::ExecToLog '"${POWERSHELL}" -NoProfile -ExecutionPolicy Bypass -File "${INSTALL_DIR}\cds-vsix.ps1" -Action install -Vsix "${INSTALL_DIR}\VSExtension\CdsVsBridge.vsix" -Log "${INSTALL_DIR}\install.log"'
  Pop $0

  ;--- Step 7b: Is Claude Code there? (P9; decides the finish page's box and a silent install's setup) ---
  StrCpy $CCFound "none"
  ${If} $NodeExe != ""
    ; detect writes its one line ("Claude Code ... found at ..." / "Claude Code: not found. ...") to
    ; install.log itself (--log, UTF-8); the installer used to log it again behind its own "Claude Code: ".
    nsExec::ExecToStack '"$NodeExe" "${INSTALL_DIR}\cds-claude-code.js" detect --log "${INSTALL_DIR}\install.log"'
    Pop $0
    Pop $1
    ${If} $0 == "0"
      StrCpy $CCFound "ok"
    ${ElseIf} $0 == "3"
      StrCpy $CCFound "old"
    ${EndIf}
  ${EndIf}
  ${If} $CCFound == "ok"
    StrCpy $CCLine "Claude Code was found: the ticked box below also sets it up for ClaudeDevStudio (its sessions load the project's memory, and chats can run phases in it; your settings are backed up first; untick to skip, undo from the tray app)."
  ${ElseIf} $CCFound == "old"
    StrCpy $CCLine "Claude Code is older than 2.1: run $\"claude update$\" in a terminal, then set it up from the tray app's menu."
  ${Else}
    StrCpy $CCLine "Claude Code is not installed. To use it with ClaudeDevStudio: in PowerShell run irm https://claude.ai/install.ps1 | iex (see code.claude.com/docs/en/setup), run $\"claude$\" once to sign in, then set it up from the tray app's menu."
  ${EndIf}

  ;--- Step 8: Claude Desktop's config: add CDS's two entries, keep everything else ---
  Delete "${INSTALL_DIR}\${MANUAL_FILE}"
  StrCpy $FinishText "ClaudeDevStudio is installed.$\r$\n$\r$\nQuit Claude Desktop fully (tray icon, Quit) and reopen it. Then ask Claude: $\"Load CDS for C:\path\to\my\project$\".$\r$\n$\r$\nIf you use Visual Studio, reopen it too.$\r$\n$\r$\n$CCLine"
  ; Claude Desktop never set up on this account (P5): no %APPDATA%\Claude and no packaged (MSIX)
  ; Claude. cds-config.js still creates the file with CDS's two servers, which Claude Desktop reads
  ; once it is installed; the finish page says what to do.
  StrCpy $NoClaudeDesktop "0"
  ${IfNot} ${FileExists} "$APPDATA\Claude\*.*"
    FindFirst $R0 $R1 "$LOCALAPPDATA\Packages\Claude_*"
    ${If} $R1 == ""
      StrCpy $NoClaudeDesktop "1"
    ${EndIf}
    FindClose $R0
  ${EndIf}
  ${If} $NoClaudeDesktop == "1"
    ${STEP} "Claude Desktop is not installed on this account yet: its settings file will be created with only ClaudeDevStudio's two servers."
    StrCpy $FinishText "ClaudeDevStudio is installed.$\r$\n$\r$\nClaude Desktop is not installed yet. ClaudeDevStudio has already added itself to Claude Desktop's settings, so: install Claude Desktop from https://claude.ai/download, sign in, then quit it fully (tray icon, Quit) and reopen it once. Then ask Claude: $\"Load CDS for C:\path\to\my\project$\".$\r$\n$\r$\n$CCLine"
  ${EndIf}
  ${If} $NodeExe == ""
    StrCpy $FinishText "ClaudeDevStudio's files are installed, but Node.js was not found, so it could not add itself to Claude Desktop.$\r$\n$\r$\nInstall Node.js LTS from https://nodejs.org and run this installer again."
    ${STEP} "Node.js not found: Claude Desktop's config not changed."
  ${Else}
    ${STEP} "Adding ClaudeDevStudio to Claude Desktop's config..."
    nsExec::ExecToLog '"$NodeExe" "${INSTALL_DIR}\cds-config.js" install --config "${CLAUDE_CONFIG}" --node "$NodeExe" --mcp "${INSTALL_DIR}\mcp-server" --log "${INSTALL_DIR}\install.log" --manual "${INSTALL_DIR}\${MANUAL_FILE}"'
    Pop $0
    ${If} $0 == "2"
      StrCpy $FinishText "ClaudeDevStudio is installed, but Claude Desktop's settings file is not valid JSON, so it was left unchanged:$\r$\n${CLAUDE_CONFIG}$\r$\n$\r$\nFix that file, or add the two entries listed in$\r$\n${INSTALL_DIR}\${MANUAL_FILE}$\r$\nby hand. Then quit Claude Desktop fully and reopen it."
    ${ElseIf} $0 != "0"
      StrCpy $FinishText "ClaudeDevStudio is installed, but it could not update Claude Desktop's settings file (code $0). See ${INSTALL_DIR}\install.log.$\r$\n$\r$\nRun this installer again, or add the claudedevstudio and cds-workbench servers to ${CLAUDE_CONFIG} by hand."
    ${EndIf}
  ${EndIf}

  ;--- Step 8b: Claude Code ---
  ${If} $ClaudeCode == "1"
    ${STEP} "Setting up Claude Code (/CLAUDECODE=1)..."
    Call RunClaudeCodeSetup
    ${STEP} "Claude Code setup done (code $0)."
  ${ElseIf} ${Silent}
  ${AndIf} $ClaudeCode != "0"
  ${AndIf} $CCFound == "ok"
  ${AndIfNot} ${FileExists} "${INSTALL_DIR}\claude-code-declined.txt"
    ; A silent install sets it up when Claude Code is there (P9), unless /CLAUDECODE=0 or the user removed it before.
    ${STEP} "Setting up Claude Code (found; silent install)..."
    Call RunClaudeCodeSetup
    ${STEP} "Claude Code setup done (code $0)."
  ${ElseIf} $NodeExe != ""
    ; Already set up by the user: refresh the paths (never turns it on).
    nsExec::ExecToLog '"$NodeExe" "${INSTALL_DIR}\cds-claude-code.js" setup --if-set-up --node "$NodeExe" --mcp "${INSTALL_DIR}\mcp-server" --log "${INSTALL_DIR}\install.log"'
    Pop $0
  ${EndIf}

  ;--- Step 9: Create data directories ---
  CreateDirectory "$DOCUMENTS\ClaudeDevStudio\Projects"
  CreateDirectory "$DOCUMENTS\ClaudeDevStudio\Backups"

  ;--- Step 10: Registry, PATH, shortcuts, autostart ---
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName"     "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon"     '"${INSTALL_DIR}\TrayApp\ClaudeDevStudio.TrayApp.exe",0'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher"       "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout"    "${PRODUCT_URL}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Contact"         "${PRODUCT_CONTACT}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "HelpLink"        "mailto:${PRODUCT_CONTACT}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "${INSTALL_DIR}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"${INSTALL_DIR}\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"${INSTALL_DIR}\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair"  1

  WriteRegStr HKCU "Software\ClaudeDevStudio" "InstallDir" "${INSTALL_DIR}"
  WriteRegStr HKCU "Software\ClaudeDevStudio" "Version"    "${PRODUCT_VERSION}"

  ; Add the CLI to the user PATH (once; the rest of PATH is kept as it is)
  nsExec::ExecToLog '"${POWERSHELL}" -NoProfile -ExecutionPolicy Bypass -File "${INSTALL_DIR}\cds-path.ps1" -Action add -Dir "${INSTALL_DIR}\CLI" -Log "${INSTALL_DIR}\install.log"'
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; Auto-start on a first install only, so an upgrade keeps the user's choice
  ${If} $9 == ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
      "ClaudeDevStudio" '"${INSTALL_DIR}\TrayApp\ClaudeDevStudio.TrayApp.exe"'
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\ClaudeDevStudio"
  CreateShortcut "$SMPROGRAMS\ClaudeDevStudio\ClaudeDevStudio.lnk" \
    "${INSTALL_DIR}\TrayApp\ClaudeDevStudio.TrayApp.exe"
  CreateShortcut "$SMPROGRAMS\ClaudeDevStudio\Uninstall.lnk" \
    "${INSTALL_DIR}\Uninstall.exe"

  WriteUninstaller "${INSTALL_DIR}\Uninstall.exe"
  ; The finish page's text, in the log too (a silent install shows no finish page).
  ${STEP} "Finish page: $FinishText"
  ${STEP} "Installation complete!"

SectionEnd

;---------------------------------------------------------------------------
; Uninstall Section
;---------------------------------------------------------------------------
Section "Uninstall"

  StrCpy $8 "$TEMP\ClaudeDevStudio-uninstall.log"

  nsExec::ExecToLog 'taskkill /IM ClaudeDevStudio.TrayApp.exe /F'
  nsExec::ExecToLog 'taskkill /IM claudedev.exe /F'

  ;--- Remove the VS Bridge from every Visual Studio found by vswhere ---
  ${If} ${FileExists} "${INSTALL_DIR}\cds-vsix.ps1"
    nsExec::ExecToLog '"${POWERSHELL}" -NoProfile -ExecutionPolicy Bypass -File "${INSTALL_DIR}\cds-vsix.ps1" -Action uninstall -Log "$8"'
    Pop $0
  ${EndIf}

  ;--- Claude Desktop's config: remove only CDS's two entries ---
  Call un.FindNode
  StrCpy $7 "ok"
  ${If} $NodeExe == ""
  ${OrIfNot} ${FileExists} "${INSTALL_DIR}\cds-config.js"
    StrCpy $7 "manual"
  ${Else}
    nsExec::ExecToLog '"$NodeExe" "${INSTALL_DIR}\cds-config.js" uninstall --config "${CLAUDE_CONFIG}" --log "$8"'
    Pop $0
    ${If} $0 != "0"
      StrCpy $7 "manual"
    ${EndIf}
  ${EndIf}

  ;--- Claude Code: take out only CDS's hooks and servers (nothing to do if never set up) ---
  ${If} $NodeExe != ""
  ${AndIf} ${FileExists} "${INSTALL_DIR}\cds-claude-code.js"
    nsExec::ExecToLog '"$NodeExe" "${INSTALL_DIR}\cds-claude-code.js" remove --log "$8"'
    Pop $0
    ${If} $0 != "0"
      MessageBox MB_ICONEXCLAMATION "ClaudeDevStudio's Claude Code hooks and servers could not be removed automatically (code $0).$\r$\nRemove the hooks that run cds-hook.js from %USERPROFILE%\.claude\settings.json, and run: claude mcp remove claudedevstudio --scope user (and cds-workbench).$\r$\n$\r$\nDetails: $8" /SD IDOK
    ${EndIf}
  ${EndIf}

  ;--- Remove the CLI from the user PATH (the rest of PATH is kept) ---
  ${If} ${FileExists} "${INSTALL_DIR}\cds-path.ps1"
    nsExec::ExecToLog '"${POWERSHELL}" -NoProfile -ExecutionPolicy Bypass -File "${INSTALL_DIR}\cds-path.ps1" -Action remove -Dir "${INSTALL_DIR}\CLI" -Log "$8"'
    Pop $0
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}

  ;--- Remove installed files (mcp-server goes with its qwen_config.json, the API keys) ---
  RMDir /r "${INSTALL_DIR}\CLI"
  RMDir /r "${INSTALL_DIR}\TrayApp"
  RMDir /r "${INSTALL_DIR}\Dashboard"
  RMDir /r "${INSTALL_DIR}\mcp-server"
  RMDir /r "${INSTALL_DIR}\review-server"
  RMDir /r "${INSTALL_DIR}\VSExtension"
  Delete   "${INSTALL_DIR}\cds-config.js"
  Delete   "${INSTALL_DIR}\cds-claude-code.js"
  Delete   "${INSTALL_DIR}\claude-code-declined.txt"
  Delete   "${INSTALL_DIR}\hooks.log"
  Delete   "${INSTALL_DIR}\hook_cache.json"
  Delete   "${INSTALL_DIR}\cds-vsix.ps1"
  Delete   "${INSTALL_DIR}\cds-path.ps1"
  Delete   "${INSTALL_DIR}\install.log"
  Delete   "${INSTALL_DIR}\${MANUAL_FILE}"
  Delete   "${INSTALL_DIR}\ConfigureClaudeDesktop.ps1"
  Delete   "${INSTALL_DIR}\install-extension.ps1"
  Delete   "${INSTALL_DIR}\Uninstall.exe"
  ; Not removed: a DebugView folder the user put here (RMDir leaves a non-empty folder).
  RMDir    "${INSTALL_DIR}"

  ;--- Remove registry and shortcuts ---
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ClaudeDevStudio"
  DeleteRegKey   HKCU "${UNINSTALL_KEY}"
  DeleteRegKey   HKCU "Software\ClaudeDevStudio"

  Delete "$SMPROGRAMS\ClaudeDevStudio\ClaudeDevStudio.lnk"
  Delete "$SMPROGRAMS\ClaudeDevStudio\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\ClaudeDevStudio"

  ${If} $7 == "manual"
    MessageBox MB_ICONEXCLAMATION "ClaudeDevStudio uninstalled, but its two servers could not be removed from Claude Desktop's settings automatically.$\r$\nRemove $\"claudedevstudio$\" and $\"cds-workbench$\" from:$\r$\n${CLAUDE_CONFIG}$\r$\n$\r$\nDetails: $8" /SD IDOK
  ${EndIf}
  MessageBox MB_ICONINFORMATION "ClaudeDevStudio uninstalled.$\r$\nYour memory in Documents\ClaudeDevStudio has been kept." /SD IDOK

SectionEnd
