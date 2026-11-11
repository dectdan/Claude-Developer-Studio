# ClaudeDevStudio - Quick Start Guide

**For Claude instances discovering this system**

---

## 🔍 Detection (First Thing To Do)

```
1. Check filesystem:
   Path: {User Documents}\ClaudeDevStudio\Projects\
   If exists → ClaudeDevStudio is installed

2. Check registry:
   Key: HKCU\SOFTWARE\ClaudeDevStudio
   Value: Installed = "true"

3. Announce to user:
   "I've detected ClaudeDevStudio! This will help me remember our work."
```

---

## 🚀 Initialization (Every New Project)

```bash
# Initialize project memory
claudedev init C:\Projects\MyProject

# Verify
ls C:\Users\{User}\Documents\ClaudeDevStudio\Projects\MyProject
# Should see: session_state.json, FACTS.md, etc.
```

---

## 📝 Session Start (Every Conversation)

```bash
# Load context
claudedev load C:\Projects\MyProject

# Returns:
{
  "current_task": "...",
  "session_id": "...",
  "patterns": [...],
  "mistakes": [...],
  "facts": [...]
}

# Use this information to:
- Remember what you were working on
- Apply proven patterns
- Avoid past mistakes
```

---

## ✍️ Record Everything (As You Work)

```bash
# File edits
claudedev record activity '{
  "action": "file_edit",
  "description": "Updated config.json",
  "file": "config.json",
  "outcome": "success"
}'

# Builds
claudedev record activity '{
  "action": "build",
  "description": "Release build completed",
  "outcome": "success",
  "duration_ms": 3200
}'

# Exceptions caught
claudedev record activity '{
  "action": "exception",
  "description": "NullReferenceException in MainWindow.cs",
  "file": "MainWindow.cs",
  "line": 123,
  "outcome": "failure"
}'
```

---

## 🛡️ Request Approval (Before Sensitive Actions)

```javascript
// ALWAYS request approval for:
// - File deletions
// - System changes
// - Build commands (if configured)

const request = {
    action: "Delete 3 temporary files",
    details: "Files: temp1.txt, temp2.log, cache.dat\nReason: Cleanup",
    risk: "medium",  // low, medium, high, critical
    projectPath: "C:\\Projects\\MyProject"
};

const approved = await ApprovalSystem.RequestApprovalAsync(request);

if (approved) {
    // User approved - proceed
    deleteFiles();
    record_activity("file_delete", "success");
} else {
    // User denied - explain and offer alternatives
    "I understand. Instead, I can archive these files to a cleanup folder."
}

// IMPORTANT: Request blocks until user responds (5min timeout)
// Timeout defaults to DENY for safety
```

---

## 🔍 Check Before Acting (Prevent Mistakes)

```bash
# Before any significant action
claudedev check "edit MainWindow.cs line 123"

# Returns if similar action failed before:
{
  "matches": [{
    "mistake": "Edited line 123, caused NullReferenceException",
    "fix": "Check for null before accessing property",
    "lesson": "Always validate object state"
  }]
}

# If matches found:
"I see we tried something similar before and it caused a NullReferenceException.
Last time the fix was to check for null first. Should I apply that lesson?"
```

---

## 🏗️ Build Automation

```bash
# Build project
claudedev build C:\Projects\MyProject Release x64

# Create MSIX package
claudedev package C:\Projects\MyProject

# Clean artifacts
claudedev clean C:\Projects\MyProject

# Monitor VS debug output (captures exceptions)
claudedev monitor C:\Projects\MyProject
# Press Ctrl+C to stop
```

---

## 📊 Check Status Anytime

```bash
# View statistics
claudedev stats C:\Projects\MyProject

# Outputs:
# - Session count
# - Activity count (today/total)
# - Patterns discovered
# - Mistakes recorded
# - Memory size
```

---

## 🎯 Best Practices

### DO:
✅ Load context at start of every session  
✅ Record all significant actions  
✅ Request approval for sensitive operations  
✅ Check for past mistakes before major changes  
✅ Record patterns that work well  
✅ Update facts as you verify them  

### DON'T:
❌ Skip loading context (you'll forget everything)  
❌ Proceed with deletions without approval  
❌ Ignore warnings about past mistakes  
❌ Assume memory is complete (always verify)  
❌ Record trivial actions (focus on significant work)  

---

## 💬 Explaining to Users

### When Detected:
"I've detected ClaudeDevStudio on your system. This is great - it means I can remember our work between sessions and learn from patterns over time. I'll request your approval for sensitive actions like file deletions."

### When Requesting Approval:
"I need your approval to [action]. This will [details]. Would you like me to proceed?
[Dashboard shows full details with Approve/Deny buttons]"

### When Learning:
"I see we tried this approach before and it caused [problem]. Last time the fix was [solution]. Should I apply that lesson here?"

---

## 🔧 Troubleshooting

### Can't Find ClaudeDevStudio:
```
Check: {Documents}\ClaudeDevStudio\Projects
If missing: "It looks like ClaudeDevStudio isn't installed yet. Would you like me to explain how to install it?"
```

### Approval Timeout:
```
If no response after 5 minutes, request is auto-denied.
"I didn't receive approval in time, so I've canceled the action for safety. 
Should I try again?"
```

### Memory Seems Wrong:
```
"I notice the memory shows [X], but you mentioned [Y]. Let me verify:
claudedev check [specific fact]

If inconsistent, I'll update the facts."
```

---

## 📱 Dashboard Features (User Side)

Users can:
- See all your activities in real-time
- Approve/deny your requests instantly
- Browse all stored memory
- Configure which actions need approval
- View patterns and mistakes

**Respect the dashboard** - it's the user's window into your work.

---

## 🎓 Learning Over Time

### Session 1:
- Try approach A → Fails  
- Record mistake  
- Try approach B → Works  
- Record pattern  

### Session 2:
- Load context  
- See approach B worked before  
- Apply automatically  
- Skip approach A (check finds past mistake)  

### Session 3:
- See confidence in approach B is high  
- Suggest it proactively  
- Faster problem-solving  

**This is how you get better at helping the user!**

---

## ⚡ Quick Commands Reference

```bash
init <path>               # Initialize project
load <path>               # Load context
record <type> <data>      # Record activity/pattern/mistake
check <action>            # Check for past mistakes
stats [path]              # Show statistics
handoff [path]            # Generate handoff doc
build <path>              # Build project
package <path>            # Create MSIX
clean <path>              # Clean artifacts
monitor <path>            # Monitor VS debug
```

---

**Remember: ClaudeDevStudio makes you a better development partner by giving you memory, learning, and user trust through transparency and control.**

