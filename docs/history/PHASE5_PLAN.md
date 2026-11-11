# ClaudeDevStudio Phase 5 - Production Product Build Plan

**Date:** 2026-02-13  
**Goal:** Transform ClaudeDevStudio from CLI tools into shippable Windows product

---

## Vision

**ClaudeDevStudio: The Development Assistant System for ANY Claude Instance**

A Windows application that:
- Installs like normal software (MSIX)
- Runs on startup (system tray)
- Provides memory across sessions
- Lets users control and approve Claude's actions
- Works with ANY Claude instance (not just this session)
- Self-documents so Claude can discover it

---

## Architecture

```
ClaudeDevStudio Product
│
├─ ClaudeDevStudio.CLI (existing)
│  └─ Command-line tools (claudedev.exe)
│
├─ ClaudeDevStudio.Core (existing)
│  ├─ ClaudeMemory.cs
│  ├─ MemoryCurator.cs
│  └─ MemorySchemas.cs
│
├─ ClaudeDevStudio.TrayApp (NEW)
│  ├─ System tray application
│  ├─ Auto-start on Windows boot
│  ├─ MCP server launcher
│  └─ Notification system
│
├─ ClaudeDevStudio.Dashboard (NEW)
│  ├─ WinUI 3 main window
│  ├─ Projects view
│  ├─ Activity timeline
│  ├─ Approval queue
│  ├─ Memory browser
│  └─ Settings/Configuration
│
├─ ClaudeDevStudio.ApprovalSystem (NEW)
│  ├─ Permission requests
│  ├─ User approval workflow
│  ├─ Auto-approve rules
│  └─ Approval history
│
└─ ClaudeDevStudio.Installer (NEW)
   ├─ MSIX package
   ├─ First-run wizard
   ├─ Auto-start configuration
   └─ MCP registration
```

---

## Phase 5 Build Tasks

### Task 1: Project Structure (30 min)
- [x] Create ClaudeDevStudio.UI directory
- [ ] Create WinUI 3 project for Dashboard
- [ ] Create system tray app project
- [ ] Set up shared Core library
- [ ] Configure solution structure

### Task 2: System Tray App (1 hour)
- [ ] System tray icon (shows status)
- [ ] Right-click context menu
- [ ] Launch dashboard window
- [ ] Auto-start configuration
- [ ] MCP server launcher
- [ ] Notification toasts

### Task 3: Dashboard UI (2 hours)
- [ ] Main window layout (WinUI 3)
- [ ] Projects list view
- [ ] Activity timeline
- [ ] Approval queue UI
- [ ] Memory browser
- [ ] Settings panel

### Task 4: Permission/Approval System (1 hour)
- [ ] Approval request API
- [ ] Permission types (delete, build, system)
- [ ] Approval queue management
- [ ] Auto-approve rules
- [ ] User notification system

### Task 5: Configuration Wizard (45 min)
- [ ] First-run detection
- [ ] Project folder selection
- [ ] Permission preferences
- [ ] MCP server setup
- [ ] Save configuration

### Task 6: MCP Server Integration (30 min)
- [ ] Auto-launch MCP server with tray app
- [ ] Health monitoring
- [ ] Restart on failure
- [ ] Port configuration

### Task 7: Self-Documentation (30 min)
- [ ] README.md for Claude discovery
- [ ] API documentation
- [ ] Usage examples
- [ ] Quick start guide

### Task 8: MSIX Installer (45 min)
- [ ] Package manifest
- [ ] App icons and assets
- [ ] Installation flow
- [ ] Auto-start registry
- [ ] Uninstaller

### Task 9: Advanced Features (2 hours)
- [ ] AI-powered analysis
- [ ] Visual timeline
- [ ] Pattern explorer
- [ ] Smart suggestions
- [ ] Performance metrics

### Task 10: Testing & Polish (1 hour)
- [ ] Install/uninstall testing
- [ ] Auto-start verification
- [ ] Permission workflow testing
- [ ] Multi-project testing
- [ ] Documentation review

**Total Estimated Time: 10 hours**

---

## Key Features

### For Users:
1. **Zero Configuration** - Auto-discovers projects
2. **Full Control** - Approve/deny any Claude action
3. **Transparency** - See everything Claude is doing
4. **Memory Browser** - View/edit all stored data
5. **Safe** - Nothing happens without permission

### For Claude:
1. **Auto-Discovery** - Finds ClaudeDevStudio via registry
2. **Session Memory** - Load context from any past session
3. **Mistake Prevention** - Check before repeating errors
4. **Pattern Learning** - Build knowledge over time
5. **Build Automation** - One-command builds

### For Developers (Anthropic):
1. **Real Product** - Not just a proof-of-concept
2. **User-Controlled** - Safety through permissions
3. **Observable** - Dashboard shows everything
4. **Extensible** - Plugin architecture ready
5. **Cross-Platform Ready** - Architecture supports Mac/Linux

---

## User Workflows

### First-Time User:
1. Download ClaudeDevStudio.msix
2. Double-click to install
3. Configuration wizard appears
4. Select projects folder
5. Configure permissions
6. Done - tray icon appears

### Daily Usage:
1. Start coding (ClaudeDevStudio auto-runs)
2. Claude detects it via MCP
3. Claude: "I see ClaudeDevStudio. Loading project memory..."
4. Claude: "I want to build SmartScribe. [Approve?]"
5. User clicks Approve in notification
6. Build runs, results saved to memory

### Dashboard Usage:
1. Click tray icon → Open Dashboard
2. See all active projects
3. Browse activity timeline
4. Review pending approvals
5. Check memory (facts, patterns, mistakes)
6. Adjust settings

---

## Technical Decisions

### UI Framework: WinUI 3
**Why:** Modern, native Windows, good performance, Microsoft-supported

### Installer: MSIX
**Why:** Modern Windows packaging, auto-update support, Store-ready

### Tray App: .NET 8 + NotifyIcon
**Why:** Lightweight, reliable, good Win32 interop

### Communication: Named Pipes + MCP
**Why:** Fast IPC, works with MCP server, no network firewall issues

### Data Storage: Existing JSON/JSONL
**Why:** Already works, human-readable, version-controllable

---

## Security Considerations

### Permission Levels:
1. **Read-Only** - View files, memory (auto-approved)
2. **Write** - Create/edit files (requires approval)
3. **Delete** - Remove files (always requires approval)
4. **Build** - Compile projects (configurable)
5. **System** - Registry, startup (always requires approval)

### Approval Rules:
- User can set auto-approve for trusted actions
- Sensitive operations always prompt
- Approval history logged
- Can revoke auto-approve at any time

---

## Future Enhancements (Post-Phase 5)

### Phase 6: Cloud Sync
- Sync memory across machines
- Team collaboration features
- Cloud backup

### Phase 7: IDE Extensions
- Visual Studio extension
- VS Code extension
- Real-time integration

### Phase 8: Cross-Platform
- macOS version
- Linux version
- Shared core code

### Phase 9: Enterprise
- Team dashboards
- Shared knowledge bases
- Admin controls
- Audit logs

---

## Success Criteria

✅ **User Can:**
- Install with one click
- See everything Claude is doing
- Approve/deny any action
- Browse all stored memory
- Configure preferences

✅ **Claude Can:**
- Auto-discover the system
- Load memory from any session
- Request permissions
- Record all activities
- Learn from patterns

✅ **Product Is:**
- Professional quality
- Well documented
- Easy to understand
- Safe by default
- Ready to ship

---

## Next Steps

1. **Build Task 1:** Set up project structure
2. **Build Task 2:** Create system tray app
3. **Build Task 3:** Build dashboard UI
4. **Continue through all tasks...**

**Ready to start building!**

