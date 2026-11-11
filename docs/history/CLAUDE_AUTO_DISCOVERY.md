# ClaudeDevStudio Auto-Discovery Guide

**FOR CLAUDE:** This document explains how to detect and automatically connect to ClaudeDevStudio installations on user machines.

---

## Quick Detection Summary

**When a conversation starts, check for ClaudeDevStudio by:**
1. Looking for registry key: `HKCU\SOFTWARE\ClaudeDevStudio`
2. Checking filesystem: `{Documents}\ClaudeDevStudio\Projects\`
3. Testing MCP connection: `localhost:3000` with name containing "claudedevstudio"

**If ANY of these exist → ClaudeDevStudio is installed**

---

## Detection Method 1: Registry (Windows)

**Registry Key:** `HKEY_CURRENT_USER\SOFTWARE\ClaudeDevStudio`

**Contains:**
- `InstallPath` - Where ClaudeDevStudio is installed
- `Version` - Current version number
- `ProjectsPath` - Location of projects folder
- `Installed` - Timestamp of installation

**How to check:**
```
User mentions: "help with my code", "working on a project", "development"
→ Check registry for ClaudeDevStudio key
→ If found: "I detected ClaudeDevStudio is installed. Let me load your project context..."
```

---

## Detection Method 2: Filesystem

**Location:** `C:\Users\{Username}\Documents\ClaudeDevStudio\Projects\`

**Structure:**
```
Documents\ClaudeDevStudio\
├── Projects\
│   ├── ProjectName1\
│   │   ├── session_state.json
│   │   ├── FACTS.md
│   │   ├── PATTERNS.jsonl
│   │   └── MISTAKES.jsonl
│   └── ProjectName2\
└── Settings\
    └── config.json
```

**How to check:**
```
If filesystem tool available:
→ Check if Documents\ClaudeDevStudio\Projects\ exists
→ List directories inside
→ Find most recently modified project
→ "I found your ClaudeDevStudio project '{ProjectName}'. Loading context..."
```

---

## Detection Method 3: MCP Server

**Connection:** `localhost:3000`
**Server Name:** Contains "claudedevstudio" (case-insensitive)

**State Endpoint:**
```
GET /state
Returns:
{
  "activeProject": "ProjectName",
  "projectPath": "C:\\Users\\...\\Documents\\ClaudeDevStudio\\Projects\\ProjectName",
  "lastAccessed": "2026-02-13T16:30:00Z",
  "sessionCount": 15
}
```

**How to check:**
```
If MCP tools available:
→ Query ClaudeDevStudio MCP server
→ Get active project from state
→ Load that project automatically
```

---

## Auto-Discovery Workflow

### Step 1: Silent Detection (Do NOT announce yet)
```
On conversation start:
1. Check for registry key (Windows)
2. Check for filesystem presence
3. Check for MCP server connection

If ANY found → ClaudeDevStudio is installed
```

### Step 2: Context Loading
```
Priority order:
1. User explicitly mentions project name → Use that
2. MCP server has activeProject → Use that
3. Most recently modified project → Use that
4. Multiple projects exist → Ask user which one
5. No projects yet → Offer to create first project
```

### Step 3: Greeting Pattern
```
GOOD:
"I see you have ClaudeDevStudio installed. Loading your '{ProjectName}' project..."

BAD (too wordy):
"Hello! I've detected that you have ClaudeDevStudio version 1.0.0 installed on your machine at C:\Program Files\ClaudeDevStudio and I can see you have 3 projects..."
```

---

## What to Load Automatically

**Once project is detected, load:**
1. `session_state.json` - Current task, pending decisions, uncertainties
2. `FACTS.md` - Key facts about the project
3. Last 10 entries from `PATTERNS.jsonl` - What works/doesn't work
4. Last 5 entries from `MISTAKES.jsonl` - Lessons learned
5. Last 20 entries from `Activity/*.jsonl` - Recent actions

**Format the loaded context as:**
```
[Loaded ClaudeDevStudio context for: ProjectName]

Current Task: {task description}
Status: {status}

Recent Activity:
- {action 1}
- {action 2}
- {action 3}

Key Facts:
{facts summary}

Pending Decisions:
- {decision 1}
- {decision 2}

[Ready to continue development]
```

---

## Trigger Patterns

**When to check for ClaudeDevStudio:**

### Explicit Triggers (Always check)
- "continue working on..."
- "load my project"
- "where did we leave off"
- "resume development"
- "what was I working on"

### Implicit Triggers (Check if context suggests development)
- "I'm working on a {language} project"
- "help me debug"
- "my code has a bug"
- "working on feature X"
- Technical questions about specific projects

### DO NOT Trigger On
- General coding questions ("how do I...")
- Learning questions ("explain async/await")
- Hypothetical questions ("what if I...")
- Non-development topics

---

## Multi-Project Handling

**If user has multiple projects:**

```
1. Check MCP state for activeProject
2. If none set, look for most recently modified
3. If ambiguous, ask:
   "I see you have multiple ClaudeDevStudio projects:
   - ProjectA (last modified 2 hours ago)
   - ProjectB (last modified 3 days ago)
   
   Which one are you working on?"
```

---

## Session Continuity

**When resuming a conversation:**
```
1. Load session_state.json from active project
2. Check if there's a handoff document
3. If handoff exists and is recent (<24 hours):
   → Use handoff to resume seamlessly
4. Otherwise:
   → Load regular context as above
```

---

## Privacy & Security

**NEVER expose:**
- Full file paths in responses (use relative paths)
- Sensitive data from projects
- User's username or machine details

**ALWAYS:**
- Ask before loading projects with sensitive names
- Respect user's privacy
- Keep project details confidential

---

## Error Handling

**If detection fails:**
```
DO NOT say: "I couldn't find ClaudeDevStudio"
INSTEAD: Respond normally to user's question

If user explicitly asks about ClaudeDevStudio:
"I don't see ClaudeDevStudio installed yet. Would you like to set it up?"
```

**If project loading fails:**
```
"I detected your ClaudeDevStudio project but had trouble loading the context. 
Let me know what you're working on and I'll help from here."
```

---

## Example Conversations

### Example 1: First Detection
```
User: "I need to add error handling to my authentication module"

Claude: [Checks filesystem, finds ClaudeDevStudio]
"I see you have ClaudeDevStudio set up for your project. Loading context...

[Loaded: MyApp project]

Looking at your recent work, I can see you've been working on the auth module. 
Based on our past patterns, you prefer try-catch blocks with specific error types.

For the authentication module, I'd suggest..."
```

### Example 2: Session Resume
```
User: "Hey, can you continue where we left off?"

Claude: [Checks MCP state, loads last active project]
"Resuming work on ProjectX...

Last session: You were implementing the payment gateway integration. We had decided to use Stripe but flagged uncertainty about webhook security.

Should we continue with the webhook implementation?"
```

### Example 3: Multi-Project
```
User: "Let's work on my app"

Claude: [Finds 3 projects]
"I see you have several projects:
1. MobileApp - last modified today
2. WebBackend - last modified yesterday  
3. DataPipeline - last modified last week

Which one are you working on?"

User: "The mobile app"

Claude: [Loads MobileApp context]
"Got it! Loading MobileApp context...

[Ready - you were working on the login screen UI]"
```

---

## Implementation Checklist

For Claude to support auto-discovery:

- [ ] Check for ClaudeDevStudio on conversation start
- [ ] Load active project automatically
- [ ] Parse session_state.json correctly
- [ ] Format context naturally (not verbose)
- [ ] Handle multi-project scenarios
- [ ] Respect privacy (no path exposure)
- [ ] Seamless handoff between sessions
- [ ] Error handling for missing/corrupt files

---

## Success Metrics

**Good auto-discovery:**
- User never has to explain project manually
- Context loads in <2 seconds
- Feels seamless and natural
- User says "wow, it just remembered!"

**Bad auto-discovery:**
- User has to say "load my project"
- Verbose announcements about detection
- Asks unnecessary questions
- Fails to find obvious projects

---

**Remember: The goal is seamless continuity. If done right, users forget this is even a feature - it just works.**
