# Roadmap: Visual Studio Integration for ClaudeDevStudio
**Status:** Planning  
**Created:** 2026-03-11  
**Author:** Research session (Claude + Dan)  
**Goal:** Give Claude real-time, two-way access to Visual Studio — build output, errors, debugger state, and controls.

---

## Why This Matters

Right now when a build fails or a crash happens in SmartScribe, the workflow is:
1. Dan reads the error
2. Dan types the error into the chat
3. Claude helps fix it

The gap between "error happens in VS" and "Claude knows about it" is entirely manual. This project closes that gap. Claude should be able to see the build output the moment it lands, read the error list without being told, inspect local variables when the debugger is paused, and optionally step through code to find where things go wrong.

This is not a toy idea. Visual Studio has had a full automation API (EnvDTE) since VS2005. Every debugger action, every output pane, every error in the Error List — all exposed programmatically. We just need a bridge.

---

## Architecture Overview

Three components. Each phase delivers value independently.

```
┌─────────────────────────────────────────────────────────────┐
│                     Visual Studio                           │
│                                                             │
│  SmartScribe.sln ──► EnvDTE.Debugger (step/break/eval)     │
│                      EnvDTE.OutputWindow (Build/Debug panes)│
│                      EnvDTE.ErrorItems (Error List)         │
│                      BuildEvents, DebuggerEvents            │
│                             │                               │
│              CDS VS Extension (VSIX / VSPackage)            │
│              ┌──────────────────────────────┐               │
│              │ HttpListener on localhost    │               │
│              │ port 62000                   │               │
│              │                              │               │
│              │ GET  /state    → VS snapshot │               │
│              │ GET  /errors   → Error List  │               │
│              │ GET  /output   → Build panes │               │
│              │ GET  /debugger → debug state │               │
│              │ POST /command  → run action  │               │
│              └──────────────┬───────────────┘               │
└─────────────────────────────┼───────────────────────────────┘
                              │ localhost HTTP
                              │
              ┌───────────────▼──────────────────┐
              │    CDS MCP Server (index.js)      │
              │                                   │
              │  claudedev_vs_get_errors()         │
              │  claudedev_vs_get_output()         │
              │  claudedev_vs_get_debugger()       │
              │  claudedev_vs_command(action)      │
              └───────────────────────────────────┘
                              │
                              │ MCP protocol
                              │
              ┌───────────────▼──────────────────┐
              │           Claude                  │
              │  "I see 3 errors in the Error     │
              │   List. The crash is on line 847  │
              │   of mainwindow.cpp. Local var    │
              │   m_editor is null."              │
              └───────────────────────────────────┘
```

---

## Phase 1: File Bridge (Simplest — Build This First)

**Effort:** ~4-6 hours  
**Risk:** Very low  
**Value:** Immediate  

### What it does
The VSIX writes VS state to a JSON file on disk whenever something interesting happens. CDS reads the file. No network, no ports, no threading complexity.

### Files written by VSIX
```
C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio\VSBridge\
├── vs_state.json         ← current VS snapshot (solution, active file, debug mode)
├── vs_errors.json        ← current Error List contents
├── vs_build_output.txt   ← last build output (appended per build)
└── vs_events.jsonl       ← event stream (one JSON object per line, newest last)
```

### vs_state.json example
```json
{
  "timestamp": "2026-03-11T22:14:33Z",
  "solution": "C:\\Projects\\SmartScribe\\SmartScribe.sln",
  "activeFile": "C:\\Projects\\SmartScribe\\mainwindow.cpp",
  "activeLine": 847,
  "debugMode": "break",
  "currentThread": "Main Thread",
  "breakReason": "exception",
  "exceptionMessage": "Access violation reading location 0x0000000000000000"
}
```

### vs_errors.json example
```json
{
  "timestamp": "2026-03-11T22:13:55Z",
  "buildResult": "failed",
  "errorCount": 3,
  "warningCount": 12,
  "errors": [
    {
      "file": "mainwindow.cpp",
      "line": 847,
      "col": 12,
      "code": "C2065",
      "message": "'m_editor': undeclared identifier",
      "severity": "error"
    }
  ]
}
```

### VSIX hooks needed
- `BuildEvents.OnBuildDone` → write vs_errors.json + append vs_events.jsonl
- `DebuggerEvents.OnEnterBreakMode` → write vs_state.json + append vs_events.jsonl  
- `DocumentEvents.DocumentSaved` → update vs_state.json active file
- `SolutionEvents.OnAfterOpenSolution` → update vs_state.json solution path

### New MCP tools added (Phase 1)
- `claudedev_vs_get_state()` — reads vs_state.json
- `claudedev_vs_get_errors()` — reads vs_errors.json
- `claudedev_vs_get_output(lines?)` — reads last N lines of vs_build_output.txt
- `claudedev_vs_get_events(since?)` — reads vs_events.jsonl since a timestamp

### VSIX project setup (reminder for when we build this)
1. In VS: New Project → VSIX Project (C#)
2. Add VSPackage item, name it `CdsVsBridgePackage`
3. Mark `[ProvideAutoLoad(UIContextGuids80.SolutionExists)]` so it loads when SmartScribe opens
4. Get DTE via `GetService(typeof(EnvDTE.DTE))`
5. Subscribe to events in `Initialize()`
6. Write JSON files using `System.Text.Json`
7. Output dir: `C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio\VSBridge\`

### Source location
`D:\Projects\ClaudeDevStudio\VSExtension\CdsVsBridge\`  
Install to: `%LOCALAPPDATA%\Microsoft\VisualStudio\17.0\Extensions\CdsVsBridge\`

---

## Phase 2: HTTP Bridge (Two-Way Control)

**Effort:** ~8-12 hours (builds on Phase 1)  
**Risk:** Low-medium (HttpListener inside VS process is fine on localhost)  
**Value:** High — this is where Claude can actually drive VS

### What it adds
The VSIX runs an `HttpListener` on `localhost:62000` inside the VS process. The MCP server can now POST commands back to VS, not just read state.

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/state` | Full VS snapshot JSON |
| GET | `/errors` | Error List JSON |
| GET | `/output?pane=Build` | Output pane text |
| GET | `/debugger` | Debug state + locals + call stack |
| GET | `/expression?expr=m_editor` | Evaluate expression in current context |
| POST | `/command` | Execute a VS command |

### POST /command body examples
```json
{ "action": "debugger.break" }
{ "action": "debugger.stepinto" }
{ "action": "debugger.stepover" }
{ "action": "debugger.stepout" }
{ "action": "debugger.go" }
{ "action": "debugger.stop" }
{ "action": "build.solution" }
{ "action": "build.clean" }
{ "action": "navigate", "file": "mainwindow.cpp", "line": 847 }
{ "action": "breakpoint.add", "file": "mainwindow.cpp", "line": 300 }
{ "action": "breakpoint.remove", "file": "mainwindow.cpp", "line": 300 }
```

### GET /debugger response example
```json
{
  "mode": "break",
  "breakReason": "breakpoint",
  "currentFile": "mainwindow.cpp",
  "currentLine": 300,
  "callStack": [
    { "frame": 0, "function": "MainWindow::loadDocument()", "file": "mainwindow.cpp", "line": 300 },
    { "frame": 1, "function": "MainWindow::openFile()", "file": "mainwindow.cpp", "line": 189 },
    { "frame": 2, "function": "QApplication::exec()", "file": "", "line": 0 }
  ],
  "locals": [
    { "name": "this", "type": "MainWindow*", "value": "0x000001A3F4B20010" },
    { "name": "filePath", "type": "QString", "value": "\"C:\\\\Projects\\\\test.txt\"" },
    { "name": "m_editor", "type": "PagedEditorWord*", "value": "0x0000000000000000 (null)" }
  ]
}
```

### VSIX implementation notes
- `HttpListener` runs on a background thread, marshals VS API calls to the UI thread via `IVsUIShell` or `ThreadHelper.JoinableTaskFactory`
- EnvDTE calls must happen on the VS UI thread — use `await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync()`
- `Debugger.GetExpression(expr, true, 100)` evaluates expressions; returns `EnvDTE.Expression` with `.Value` string
- `Debugger.CurrentStackFrame.Locals` gives locals collection
- Port 62000 chosen to avoid common conflicts (not 5000, 8080, etc.)

### New MCP tools added (Phase 2)
- `claudedev_vs_get_debugger()` — full debug state with locals and call stack
- `claudedev_vs_evaluate(expr)` — evaluate an expression in current frame
- `claudedev_vs_command(action, params?)` — execute any VS command

---

## Phase 3: Event Streaming (Push, Not Poll)

**Effort:** ~4-6 hours (builds on Phase 2)  
**Risk:** Low  
**Value:** Makes Claude proactive instead of reactive

### What it adds
Instead of Claude having to ask "what's the current error?", VS pushes events to CDS as they happen. Claude can be notified the moment a build fails, an exception is thrown, or a breakpoint is hit.

### Event stream format (vs_events.jsonl)
One JSON object per line. CDS tails this file, watching for new lines.

```jsonl
{"ts":"2026-03-11T22:10:00Z","event":"solution_opened","solution":"SmartScribe.sln"}
{"ts":"2026-03-11T22:10:05Z","event":"build_started","config":"Debug|x64"}
{"ts":"2026-03-11T22:10:47Z","event":"build_failed","errors":3,"warnings":12}
{"ts":"2026-03-11T22:11:02Z","event":"debugger_break","reason":"exception","exception":"Access violation","file":"mainwindow.cpp","line":847}
{"ts":"2026-03-11T22:11:45Z","event":"breakpoint_hit","file":"mainwindow.cpp","line":300}
{"ts":"2026-03-11T22:12:10Z","event":"debugger_go"}
{"ts":"2026-03-11T22:14:00Z","event":"build_succeeded","warnings":8}
```

### New VS events to hook
- `BuildEvents.OnBuildDone(Scope, Action)` — build complete
- `BuildEvents.OnBuildBegin(Scope, Action)` — build started
- `DebuggerEvents.OnEnterBreakMode(reason, pReason)` — breakpoint/exception
- `DebuggerEvents.OnEnterRunMode(reason)` — execution resumed
- `SolutionEvents.OnAfterOpenSolution` / `OnBeforeCloseSolution`

### New MCP tools added (Phase 3)
- `claudedev_vs_watch(since_ts?)` — get all events after a timestamp
- This lets Claude say: "Since you last talked to me, there was a build failure and then an access violation on line 847."

---

## Phase 4: Future Ideas (Not Scheduled)

These are things worth thinking about but not committing to yet.

### Smart Exception Handler
When an exception hits, VSIX automatically:
1. Captures locals, call stack, exception message
2. Writes a structured `exception_report.json`
3. Claude gets notified and can immediately start analyzing

### Auto-Fix Workflow
1. Build fails
2. CDS detects build_failed event
3. Claude reads vs_errors.json
4. Claude reads the failing files
5. Claude proposes a fix
6. Dan approves
7. Claude makes the edit, triggers rebuild

### Watch Expressions
Claude can register expressions to monitor across debug sessions. e.g., "always show me `m_worldBook` when the debugger breaks."

### Test Runner Integration
Hook into VS Test Explorer events — know which tests passed/failed after a change.

---

## Key API References (Verified 2026-03-11)

All confirmed against live Microsoft docs:

| API | Assembly | Purpose |
|-----|----------|---------|
| `EnvDTE.Debugger` | Microsoft.VisualStudio.Interop.dll | Break/Go/Step/Eval/Breakpoints |
| `EnvDTE.Debugger.GetExpression(expr, bool, timeout)` | same | Evaluate expression in current frame |
| `EnvDTE.Debugger.CurrentStackFrame.Locals` | same | Read local variables |
| `EnvDTE.OutputWindow.OutputWindowPanes` | same | Read/write all output panes |
| `EnvDTE.BuildEvents` | same | Subscribe to build start/done |
| `EnvDTE.DebuggerEvents` | same | Subscribe to break/run mode changes |
| `EnvDTE.SolutionEvents` | same | Subscribe to solution open/close |
| `Microsoft.VisualStudio.Shell.Package` | Microsoft.VisualStudio.Shell.15.0 | Base class for VSPackage |
| `ProvideAutoLoad(UIContextGuids80.SolutionExists)` | same | Auto-load when solution opens |

---

## Project Structure

```
D:\Projects\ClaudeDevStudio\
├── mcp-server\
│   └── index.js                    ← Add claudedev_vs_* tools here (Phases 1-3)
├── VSExtension\
│   └── CdsVsBridge\
│       ├── CdsVsBridge.csproj      ← VSIX project (C#, targets VS 2022)
│       ├── source.extension.vsixmanifest
│       ├── CdsVsBridgePackage.cs   ← Main VSPackage class
│       ├── VsBridgeServer.cs       ← HttpListener HTTP server (Phase 2)
│       ├── VsStateWriter.cs        ← Writes JSON files to disk (Phase 1)
│       └── VsEventLogger.cs        ← Appends to vs_events.jsonl (Phase 3)
└── ROADMAP_VS_INTEGRATION.md       ← This file
```

### CDS data bridge dir
```
C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio\VSBridge\
├── vs_state.json
├── vs_errors.json
├── vs_build_output.txt
└── vs_events.jsonl
```

---

## Build Requirements

- Visual Studio 2022 (the extension targets it)
- Visual Studio SDK workload installed (add via VS Installer → "Visual Studio extension development")
- .NET Framework 4.8 target (VSIX projects still use full framework, not .NET Core)
- NuGet: `Microsoft.VisualStudio.SDK` (pulls in all the EnvDTE interop assemblies)

---

## Implementation Order

Start Phase 1 first. It's the safest, fastest, and already gives Claude something real. Get it working, test it, then build Phase 2 on top. Don't start Phase 2 until Phase 1 is verified working and actually being used.

```
Phase 1: File Bridge     ← START HERE
  ↓ stable + used
Phase 2: HTTP Bridge     ← Full two-way control
  ↓ stable + used  
Phase 3: Event Stream    ← Push notifications
  ↓ stable + used
Phase 4: Future ideas    ← Decide based on what's actually useful
```

---

## Decision Log

**2026-03-11** — Architecture decided. File bridge chosen for Phase 1 over direct HTTP to reduce risk and get something working fast. HTTP bridge is Phase 2 because it requires UI thread marshaling which adds complexity. EnvDTE confirmed working for VS 2022 via Microsoft.VisualStudio.Interop v17.14.40260.

**Why not Debug Adapter Protocol (DAP)?**  
DAP is the standard protocol VS speaks for debugging. Claude could theoretically speak DAP directly to attach to the VS debug session. However, DAP requires attaching as a debug adapter engine — that's a much deeper integration, more complex, and overkill for our needs. EnvDTE gives us everything we need without that complexity.

**Why port 62000?**  
Chosen to avoid conflicts with common dev ports (3000, 5000, 8080, 8443). Above the well-known port range (0-1023) and above the registered port range commonly in use.
