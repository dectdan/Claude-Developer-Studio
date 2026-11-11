# Overnight Changes — Ready to Install
*Prepared while you slept. Build: ✅ 0 errors.*

## What Was Done

### 1. Build Output Capture (was a known gap)
**File:** `CdsVsBridgePackage.cs` → `OnBuildDone()`

After each build completes, the extension now reads the full Build output window
pane text and writes it to `vs_build_output.txt`. Previously that file was
created but always empty. Now `claudedev_vs_get_output` will return real content.

### 2. Solution-Already-Open Event (was a known gap)
**File:** `CdsVsBridgePackage.cs` → `InitializeAsync()`

When VS has a solution open at the time the package loads, `solution_opened`
never fires. Now we detect this and log `solution_already_open` instead, so
`claudedev_vs_get_events` always shows a solution event on startup.

### 3. Call Stack File & Line Numbers (was a known gap)
**File:** `VsBridgeServer.cs` → `GetDebuggerJsonAsync()`

Used `dynamic` late-binding to safely call `StackFrame2.FileName` /
`StackFrame2.LineNumber` without a hard `EnvDTE90` type dependency (which
caused build failures before). Each frame in the call stack now includes:
```json
{ "frame": 0, "function": "MyMethod", "module": "MyApp", "file": "C:\\...\\MyClass.cs", "line": 42 }
```

### 4. CurrentFile / CurrentLine in /debugger Response (was hardcoded null/0)
**File:** `VsBridgeServer.cs` → `GetDebuggerJsonAsync()`

The top-level `currentFile` and `currentLine` fields are now populated from
the top of the call stack (or falls back to the active document). When you
hit a breakpoint, `claudedev_vs_get_debugger` will immediately tell me exactly
which file and line you're paused on.

### 5. Microsoft.CSharp Reference Added (required for dynamic)
**File:** `CdsVsBridge.csproj`

Added `<Reference Include="Microsoft.CSharp" />` — required for the `dynamic`
keyword in .NET Framework 4.8.

---

## To Install

**Visual Studio must be closed.** Then either:

**Option A — Double-click VSIX (easiest):**
```
D:\Projects\ClaudeDevStudio\VSExtension\CdsVsBridge\bin\Debug\CdsVsBridge.vsix
```

**Option B — Copy DLL manually:**
```powershell
Copy-Item 'D:\Projects\ClaudeDevStudio\VSExtension\CdsVsBridge\bin\Debug\CdsVsBridge.dll' `
  'C:\Users\Big_D\AppData\Local\Microsoft\VisualStudio\17.0_c7705ad0\Extensions\ny4ethgt.bvw\CdsVsBridge.dll' -Force
```

Then reopen VS and we can test by hitting a breakpoint.

---

## What's Left (Phase 3 ideas when you wake up)
- **Push/poll endpoint** — MCP polls `/events?since=<ts>` so Claude gets
  notified of breaks/builds without you having to ask
- **Exception auto-intercept** — when debugger breaks on unhandled exception,
  automatically fetch state + suggest fix
- **`/projects` endpoint** — list all projects in the solution with build status
