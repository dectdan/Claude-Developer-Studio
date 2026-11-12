using System;
using System.IO;
using System.Linq;
using ClaudeDevStudio.Memory;
using ClaudeDevStudio.Core;

namespace ClaudeDevStudio
{
    /// <summary>
    /// Command-line interface for ClaudeDevStudio
    /// 
    /// Usage:
    ///   claudedev init <project_path>        Initialize memory system for project
    ///   claudedev load <project_path>        Load context (used by Claude at session start)
    ///   claudedev record <project_path> <type> <json>
    ///                                        Record activity/pattern/mistake/decision/performance/handoff
    ///   claudedev check <project_path> <action>  Check if action matches prior mistake (or a lesson for every project)
    ///   claudedev lesson add|list|edit|remove     The lessons for every project (LESSONS.jsonl)
    ///   claudedev stats                      Show memory statistics
    ///   claudedev handoff                    Automatic handoff (never replaces an explicit one)
    ///   claudedev cleanup                    Run daily memory cleanup
    ///   claudedev build <project_path>       Build project
    ///   claudedev package <project_path>     Create MSIX package
    ///   claudedev clean <project_path>       Clean build artifacts
    /// </summary>
    class Program
    {
        // The product version, from Directory.Build.props (the one place it is set).
        static string ProductVersion =>
            typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "unknown";

        static int Main(string[] args)
        {
            // Symbols such as ✓ and ⚠ must reach callers (index.js reads stdout as UTF-8)
            // as UTF-8, not in the console's code page. No BOM.
            try { Console.OutputEncoding = new System.Text.UTF8Encoding(false); } catch { /* no console */ }

            try
            {
                if (args.Length == 0)
                {
                    ShowHelp();
                    return 0;
                }

                var command = args[0].ToLower();

                return command switch
                {
                    "init" => InitProject(args),
                    "load" => LoadContext(args),
                    "record" => RecordData(args),
                    "check" => CheckAction(args),
                    "lesson" or "lessons" => LessonCommand(args),
                    "stats" => ShowStats(args),
                    "handoff" => GenerateHandoff(args),
                    "cleanup" => RunCleanup(args),
                    "monitor" => MonitorDebug(args),
                    "build" => BuildProject(args),
                    "package" => PackageProject(args),
                    "clean" => CleanProject(args),
                    "restart" => RestartComponents(args),
                    "status" => ShowComponentStatus(args),
                    "projects" => ListProjects(args),
                    "switch" => SwitchProject(args),
                    "active" => ShowActiveProject(args),
                    "autoload" => AutoLoadProject(args),
                    "backup" => BackupProject(args),
                    "restore" => RestoreBackup(args),
                    "backups" => ListBackups(args),
                    "git" => GitCommand(args),
                    "cloud" => CloudCommand(args),
                    "sync" => SyncProject(args),
                    "update" => UpdateCommand(args),
                    "configure-claude" or "link-claude" => ConfigureClaude(),
                    "claude-code" => ClaudeCodeCommand(args),
                    "version" or "--version" or "-v" => ShowVersion(),
                    "help" or "--help" or "-h" => ShowHelp(),
                    _ => Error($"Unknown command: {command}")
                };
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error: {ex.Message}");
                Console.Error.WriteLine(ex.StackTrace);
                return 1;
            }
        }

        #region Commands

        static int InitProject(string[] args)
        {
            if (args.Length < 2)
                return Error("Usage: claudedev init <project_path>");

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var memory = new ClaudeMemory(projectPath);
            memory.InitializeNewSession();

            var memoryLocation = Path.Combine(MemoryPaths.Root, "Projects", Path.GetFileName(projectPath));

            Console.WriteLine($"✓ Initialized ClaudeDevStudio memory for: {Path.GetFileName(projectPath)}");
            Console.WriteLine($"  Memory location: {memoryLocation}");
            
            return 0;
        }

        static int LoadContext(string[] args)
        {
            if (args.Length < 2)
                return Error("Usage: claudedev load <project_path>");

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var memory = new ClaudeMemory(projectPath);
            memory.LoadContext();

            var state = memory.GetSessionState();
            Console.WriteLine($"Session: {state.SessionId}");
            Console.WriteLine($"Started: {state.Started:yyyy-MM-dd HH:mm}");
            
            if (state.CurrentTask != null)
            {
                Console.WriteLine($"\nCurrent Task: {state.CurrentTask.Description}");
                Console.WriteLine($"Status: {state.CurrentTask.Status}");
                
                if (state.CurrentTask.NextSteps.Any())
                {
                    Console.WriteLine("\nNext Steps:");
                    foreach (var step in state.CurrentTask.NextSteps)
                    {
                        Console.WriteLine($"  - {step}");
                    }
                }
            }

            if (state.DecisionsPending.Any())
            {
                Console.WriteLine($"\n⚠️ Pending Decisions: {state.DecisionsPending.Count}");
                foreach (var decision in state.DecisionsPending)
                {
                    Console.WriteLine($"  - {decision.Question}");
                }
            }

            if (state.UncertaintiesFlagged.Any())
            {
                Console.WriteLine($"\n❓ Flagged Uncertainties: {state.UncertaintiesFlagged.Count}");
                foreach (var uncertainty in state.UncertaintiesFlagged)
                {
                    Console.WriteLine($"  - {uncertainty}");
                }
            }

            return 0;
        }

        static int RecordData(string[] args)
        {
            if (args.Length < 4)
            {
                Console.WriteLine("Usage: claudedev record <project_path> <type> <json_data>");
                Console.WriteLine("Types: activity, pattern, mistake, decision, performance, handoff");
                return 1;
            }

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var type = args[2].ToLower();
            // --auto (handoffs only): an automatic handoff, which never replaces an explicit one.
            var automatic = args.Skip(3).Any(a => a == "--auto");
            var jsonData = string.Join(" ", args.Skip(3).Where(a => a != "--auto"));

            var memory = new ClaudeMemory(projectPath);

            switch (type)
            {
                case "activity":
                    var activity = System.Text.Json.JsonSerializer.Deserialize<Activity>(jsonData);
                    if (activity != null)
                    {
                        memory.RecordActivity(activity);
                        Console.WriteLine($"✓ Recorded activity: {activity.Action}");
                    }
                    break;

                case "pattern":
                    var pattern = System.Text.Json.JsonSerializer.Deserialize<Pattern>(jsonData);
                    if (pattern != null)
                    {
                        memory.RecordPattern(pattern);
                        Console.WriteLine($"✓ Recorded pattern: {pattern.PatternDescription}");
                    }
                    break;

                case "mistake":
                    var mistake = System.Text.Json.JsonSerializer.Deserialize<Mistake>(jsonData);
                    if (mistake != null)
                    {
                        memory.RecordMistake(mistake);
                        Console.WriteLine($"✓ Recorded mistake: {mistake.MistakeDescription}");
                    }
                    break;

                case "decision":
                    var decision = System.Text.Json.JsonSerializer.Deserialize<Decision>(jsonData);
                    if (decision == null || string.IsNullOrWhiteSpace(decision.DecisionDescription))
                        return Error("A decision needs \"decision\" (what was decided).");
                    memory.RecordDecision(decision);
                    Console.WriteLine($"✓ Recorded decision {decision.Id}: {decision.DecisionDescription}");
                    break;

                case "handoff":
                    // {"where_i_stopped": "...", "next_step": "...", "open_questions": ["..."], "notes": "...", "origin": "..."}
                    var handoff = System.Text.Json.JsonSerializer.Deserialize<Handoff>(jsonData);
                    if (handoff == null || string.IsNullOrWhiteSpace(handoff.WhereIStopped) || string.IsNullOrWhiteSpace(handoff.NextStep))
                        return Error("A handoff needs \"where_i_stopped\" and \"next_step\".");
                    if (automatic)
                    {
                        var wrote = memory.RecordAutomaticHandoff(handoff);
                        Console.WriteLine(wrote
                            ? $"✓ Recorded automatic handoff {handoff.Id}: {memory.HandoffPath}"
                            : $"✓ Automatic handoff {handoff.Id} saved in HANDOFFS.jsonl; the explicit handoff is kept: {memory.HandoffPath}");
                    }
                    else
                    {
                        memory.RecordHandoff(handoff);
                        Console.WriteLine($"✓ Recorded handoff {handoff.Id}: {memory.HandoffPath}");
                    }
                    break;

                case "performance":
                    var perf = System.Text.Json.JsonSerializer.Deserialize<Performance>(jsonData);
                    if (perf != null)
                    {
                        memory.RecordPerformance(perf);
                        Console.WriteLine($"✓ Recorded performance: {perf.Operation} = {perf.Duration}{perf.Unit}");
                    }
                    break;

                default:
                    return Error($"Unknown record type: {type}");
            }

            return 0;
        }

        static int CheckAction(string[] args)
        {
            if (args.Length < 3)
                return Error("Usage: claudedev check <project_path> <action_description>");

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var actionDescription = string.Join(" ", args.Skip(2));

            var memory = new ClaudeMemory(projectPath);
            var check = memory.CheckForMistake(actionDescription);
            var found = false;

            if (check.FoundPriorAttempt && check.PriorMistake != null)
            {
                Console.WriteLine("⚠️ WARNING: This action matches a prior mistake!");
                Console.WriteLine($"\nMistake ID: {check.PriorMistake.Id}");
                Console.WriteLine($"Date: {check.PriorMistake.Timestamp:yyyy-MM-dd}");
                Console.WriteLine($"What happened: {check.PriorMistake.Impact}");
                Console.WriteLine($"Lesson learned: {check.PriorMistake.Lesson}");
                Console.WriteLine($"\nRecommended alternative: {check.Alternative}");
                found = true;
            }

            // The lessons for every project (P5), same rule. Exit code 1 for either kind of match.
            var lessons = LessonStore.Matches(actionDescription);
            if (lessons.Any())
            {
                if (found) Console.WriteLine();
                Console.WriteLine($"⚠️ WARNING: This action matches {(lessons.Count == 1 ? "a lesson" : $"{lessons.Count} lessons")} for every project (machine-wide, {LessonStore.FilePath}):");
                foreach (var (lesson, _) in lessons.Take(3))
                {
                    Console.WriteLine($"\nLesson ID: {lesson.Id}");
                    Console.WriteLine($"Lesson: {lesson.Text}");
                    if (!string.IsNullOrWhiteSpace(lesson.Why))
                        Console.WriteLine($"Learned: {lesson.Why}");
                }
                found = true;
            }

            if (found)
                return 1;
            Console.WriteLine("✓ No prior mistakes found for this action");
            return 0;
        }

        // claudedev lesson add <json> [--force] | add --file <file.jsonl> [--force] | list
        //                   | edit <LSN###> <json> [--force] | remove <LSN###>
        // The lessons for every project (P5): LESSONS.jsonl at the memory root. JSON fields:
        // "lesson" (required), "why" (where it was learned), "source_project" (optional).
        static int LessonCommand(string[] args)
        {
            var action = args.Length > 1 ? args[1].ToLower() : "list";
            var force = args.Any(a => a == "--force");
            var rest = args.Skip(2).Where(a => a != "--force").ToList();
            const string usage = "Usage: claudedev lesson add <json> [--force] | add --file <lessons.jsonl> | list | edit <LSN###> <json> | remove <LSN###>";

            Lesson? Parse(string json)
            {
                try { return System.Text.Json.JsonSerializer.Deserialize<Lesson>(json); }
                catch (System.Text.Json.JsonException ex) { Console.Error.WriteLine($"Not JSON: {ex.Message}"); return null; }
            }

            switch (action)
            {
                case "add":
                {
                    if (rest.Count >= 2 && rest[0] == "--file")
                    {
                        // One lesson per line; each goes through the same rules. Blank lines and lines
                        // starting with // or # are skipped.
                        if (!File.Exists(rest[1])) return Error($"File not found: {rest[1]}");
                        int added = 0, refused = 0;
                        foreach (var raw in File.ReadAllLines(rest[1]))
                        {
                            var line = raw.Trim().TrimStart('﻿');
                            if (line.Length == 0 || line.StartsWith("//") || line.StartsWith("#")) continue;
                            var l = Parse(line);
                            if (l == null) { refused++; continue; }
                            var r = LessonStore.Add(l, force, out var why);
                            if (r != null) { added++; Console.WriteLine($"✓ Recorded lesson {r.Id}: {r.Text}"); }
                            else { refused++; Console.WriteLine($"✗ {why} ({Shorten(l.Text, 80)})"); }
                        }
                        Console.WriteLine($"{added} added, {refused} refused. File: {LessonStore.FilePath}");
                        return refused > 0 && added == 0 ? 1 : 0;
                    }
                    if (rest.Count == 0) return Error(usage);
                    var lesson = Parse(string.Join(" ", rest));
                    if (lesson == null) return 1;
                    var recorded = LessonStore.Add(lesson, force, out var refusal);
                    if (recorded == null) { Console.WriteLine(refusal); return 1; }
                    Console.WriteLine($"✓ Recorded lesson {recorded.Id}: {recorded.Text}");
                    Console.WriteLine($"  File: {LessonStore.FilePath}");
                    return 0;
                }
                case "list":
                {
                    var all = LessonStore.ReadAll();
                    if (!all.Any()) { Console.WriteLine($"No lessons for every project yet ({LessonStore.FilePath})."); return 0; }
                    Console.WriteLine($"{all.Count} lesson{(all.Count == 1 ? "" : "s")} for every project ({LessonStore.FilePath}):");
                    foreach (var l in all)
                        Console.WriteLine($"{l.Id}  [{l.Timestamp:yyyy-MM-dd}] {l.Text}{(string.IsNullOrWhiteSpace(l.Why) ? "" : $"  | why: {l.Why}")}");
                    return 0;
                }
                case "edit":
                {
                    if (rest.Count < 2) return Error(usage);
                    var changes = Parse(string.Join(" ", rest.Skip(1)));
                    if (changes == null) return 1;
                    if (!LessonStore.Edit(rest[0], changes, force, out var refusal))
                        return Error($"No lesson {rest[0]} in {LessonStore.FilePath} (claudedev lesson list shows them).");
                    if (refusal != null) { Console.WriteLine(refusal); return 1; }
                    Console.WriteLine($"✓ Changed lesson {rest[0].ToUpper()} (the previous file is LESSONS.jsonl.bak).");
                    return 0;
                }
                case "remove":
                {
                    if (rest.Count < 1) return Error(usage);
                    if (!LessonStore.Remove(rest[0], out var removed))
                        return Error($"No lesson {rest[0]} in {LessonStore.FilePath} (claudedev lesson list shows them).");
                    Console.WriteLine($"✓ Removed lesson {removed!.Id}: {removed.Text} (the previous file is LESSONS.jsonl.bak).");
                    return 0;
                }
                default:
                    return Error(usage);
            }
        }

        static string Shorten(string? s, int max)
        {
            var t = (s ?? string.Empty).Trim();
            return t.Length > max ? t[..max] + "..." : t;
        }

        static int ShowStats(string[] args)
        {
            var projectPath = args.Length > 1 ? args[1] : Directory.GetCurrentDirectory();
            
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var memory = new ClaudeMemory(projectPath);
            memory.LoadContext();

            var state = memory.GetSessionState();
            
            Console.WriteLine("=== ClaudeDevStudio Memory Statistics ===");
            Console.WriteLine($"\nProject: {Path.GetFileName(projectPath)}");
            Console.WriteLine($"Session: {state.SessionId}");
            Console.WriteLine($"Uptime: {(DateTime.Now - state.Started).TotalMinutes:F1} minutes");
            
            if (state.ContextUsage != null)
            {
                Console.WriteLine($"\nContext Usage:");
                Console.WriteLine($"  Tokens used: {state.ContextUsage.TokensUsed:N0} / {state.ContextUsage.TokensLimit:N0}");
                Console.WriteLine($"  Percentage: {state.ContextUsage.Percentage:F1}%");
                
                if (state.ContextUsage.ShouldHandoff)
                {
                    Console.WriteLine("  ⚠️ CRITICAL - Handoff recommended!");
                }
                else if (state.ContextUsage.TokensUsed > state.ContextUsage.WarningThreshold)
                {
                    Console.WriteLine("  ⚠️ WARNING - Approaching context limit");
                }
            }

            var recentActivities = memory.GetRecentActivities(100);
            Console.WriteLine($"\nRecent Activity (today):");
            Console.WriteLine($"  Total actions: {recentActivities.Count}");
            
            var errorCount = recentActivities.Count(a => a.Outcome == "failure");
            var successCount = recentActivities.Count(a => a.Outcome == "success");
            
            if (successCount + errorCount > 0)
            {
                var successRate = (double)successCount / (successCount + errorCount) * 100;
                Console.WriteLine($"  Success rate: {successRate:F1}%");
                Console.WriteLine($"  Errors: {errorCount}");
            }

            var memoryPath = SessionStateManager.GetMemoryPath(Path.GetFileName(projectPath));
            if (Directory.Exists(memoryPath))
            {
                var totalSize = GetDirectorySize(memoryPath);
                Console.WriteLine($"\nStorage:");
                Console.WriteLine($"  Memory size: {totalSize / 1024.0 / 1024.0:F2} MB");
                Console.WriteLine($"  Location: {memoryPath}");
            }

            return 0;
        }

        static int GenerateHandoff(string[] args)
        {
            var projectPath = args.Length > 1 ? args[1] : Directory.GetCurrentDirectory();
            
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var memory = new ClaudeMemory(projectPath);
            memory.LoadContext();

            // An automatic handoff from the session state. It never replaces an explicit
            // handoff (record <path> handoff, the claudedev_handoff tool) in session_handoff.md.
            // (Before v1.4 this set the token counter to 200,000 to trigger the handoff, and
            // that value stayed in session_state.json.)
            var wrote = memory.WriteAutomaticHandoff(out var handoff);
            var handoffPath = memory.HandoffPath;

            if (!File.Exists(handoffPath))
                return Error("Failed to generate handoff document");

            Console.WriteLine(wrote
                ? $"✓ Automatic handoff {handoff.Id} written:"
                : $"✓ Automatic handoff {handoff.Id} saved in HANDOFFS.jsonl; the explicit handoff is kept:");
            Console.WriteLine($"  {handoffPath}");
            Console.WriteLine();
            Console.WriteLine(File.ReadAllText(handoffPath));

            return 0;
        }

        static int RunCleanup(string[] args)
        {
            var projectPath = args.Length > 1 ? args[1] : Directory.GetCurrentDirectory();
            
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var memory = new ClaudeMemory(projectPath);
            memory.LoadContext();
            
            var report = memory.RunDailyCleanup();
            
            return 0;
        }

        // The debug monitor (VSDebugMonitor.cs, which needed Sysinternals DebugView) was removed
        // in 1.5.0 (P6): the command stays only to say so and what to use instead.
        static int MonitorDebug(string[] args)
        {
            Console.WriteLine("claudedev monitor was removed in ClaudeDevStudio 1.5.0. For a running program's Debug.WriteLine/trace output, ask Claude to use claudedev_vs_get_output with pane \"debug\" (Visual Studio with the CDS VS Bridge).");
            return 1;
        }

        static int BuildProject(string[] args)
        {
            if (args.Length < 2)
                return Error("Usage: claudedev build <project_path> [Debug|Release] [x64|x86]");

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var configuration = args.Length > 2 ? args[2] : "Debug";
            var platform = args.Length > 3 ? args[3] : "x64";

            var memory = new ClaudeMemory(projectPath);
            var automation = new BuildAutomation(projectPath, memory);

            var result = automation.BuildProjectAsync(configuration, platform).Result;

            if (result.Success)
            {
                Console.WriteLine();
                Console.WriteLine($"Build completed successfully in {result.Duration.TotalSeconds:F1}s");
                return 0;
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine();
                Console.WriteLine($"Build failed: {result.Error}");
                if (result.ErrorCount > 0)
                    Console.WriteLine($"  {result.ErrorCount} error(s), {result.WarningCount} warning(s)");
                Console.ResetColor();
                return 1;
            }
        }

        static int PackageProject(string[] args)
        {
            if (args.Length < 2)
                return Error("Usage: claudedev package <project_path>");

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var memory = new ClaudeMemory(projectPath);
            var automation = new BuildAutomation(projectPath, memory);

            var result = automation.CreateMSIXPackageAsync().Result;

            if (result.Success)
            {
                Console.WriteLine();
                Console.WriteLine($"Package created successfully in {result.Duration.TotalSeconds:F1}s");
                Console.WriteLine($"Location: {result.PackagePath}");
                return 0;
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine();
                Console.WriteLine($"Packaging failed: {result.Error}");
                Console.ResetColor();
                return 1;
            }
        }

        static int CleanProject(string[] args)
        {
            if (args.Length < 2)
                return Error("Usage: claudedev clean <project_path>");

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var memory = new ClaudeMemory(projectPath);
            var automation = new BuildAutomation(projectPath, memory);

            var success = automation.CleanProjectAsync().Result;

            if (success)
            {
                Console.WriteLine("Project cleaned successfully");
                return 0;
            }
            else
            {
                Console.WriteLine("Clean failed");
                return 1;
            }
        }

        static int RestartComponents(string[] args)
        {
            if (args.Length < 2)
            {
                Console.WriteLine("Usage: claudedev restart [all|tray|dashboard|mcp]");
                return 1;
            }

            var component = args[1].ToLower();

            Console.WriteLine("Restarting ClaudeDevStudio components...");

            switch (component)
            {
                case "all":
                    Core.ComponentManager.RestartAll();
                    Console.WriteLine("✓ All components restarted");
                    break;

                case "tray":
                    if (Core.ComponentManager.RestartTrayApp())
                        Console.WriteLine("✓ Tray app restarted");
                    else
                        Console.WriteLine("✗ Failed to restart tray app");
                    break;

                case "dashboard":
                    if (Core.ComponentManager.RestartDashboard())
                        Console.WriteLine("✓ Dashboard restarted");
                    else
                        Console.WriteLine("✗ Failed to restart dashboard");
                    break;

                case "mcp":
                    if (Core.ComponentManager.RestartMcpServer())
                        Console.WriteLine("✓ MCP server restarted");
                    else
                        Console.WriteLine("✗ Failed to restart MCP server");
                    break;

                default:
                    return Error($"Unknown component: {component}");
            }

            return 0;
        }

        static int ShowComponentStatus(string[] args)
        {
            var status = Core.ComponentManager.GetStatus();

            Console.WriteLine("=== ClaudeDevStudio Component Status ===");
            Console.WriteLine();
            Console.WriteLine($"Tray App:    {(status.TrayAppRunning ? "✓ Running" : "✗ Stopped")}");
            Console.WriteLine($"Dashboard:   {(status.DashboardRunning ? "✓ Running" : "✗ Stopped")}");
            Console.WriteLine($"MCP Server:  {(status.McpServerRunning ? "✓ Running" : "✗ Stopped")}");
            Console.WriteLine();

            if (status.AllRunning)
            {
                Console.WriteLine("All components are running ✓");
            }
            else
            {
                Console.WriteLine("⚠️ Some components are not running");
                Console.WriteLine("Run 'claudedev restart all' to start all components");
            }

            return status.AllRunning ? 0 : 1;
        }

        static int ListProjects(string[] args)
        {
            var autoLoader = new Core.ContextAutoLoader();
            var projects = autoLoader.GetAllProjects();

            if (!projects.Any())
            {
                Console.WriteLine("No ClaudeDevStudio projects found.");
                Console.WriteLine();
                Console.WriteLine("Create a project with: claudedev init <project_path>");
                return 1;
            }

            Console.WriteLine("=== ClaudeDevStudio Projects ===");
            Console.WriteLine();

            var stateManager = new Core.SessionStateManager();
            var activeState = stateManager.GetState();

            foreach (var project in projects)
            {
                var isActive = project.Path == activeState.ActiveProjectPath;
                var marker = isActive ? "→" : " ";
                var timeSince = GetTimeSince(project.LastAccessed);

                Console.WriteLine($"{marker} {project.Name}");
                Console.WriteLine($"   Path: {project.Path}");
                Console.WriteLine($"   Last accessed: {timeSince}");
                Console.WriteLine();
            }

            return 0;
        }

        static int SwitchProject(string[] args)
        {
            if (args.Length < 2)
            {
                Console.WriteLine("Usage: claudedev switch <project_name>");
                Console.WriteLine();
                Console.WriteLine("Available projects:");
                
                var autoLoader = new Core.ContextAutoLoader();
                var projects = autoLoader.GetAllProjects();
                
                foreach (var p in projects)
                {
                    Console.WriteLine($"  - {p.Name}");
                }
                
                return 1;
            }

            var projectName = args[1];
            var loader = new Core.ContextAutoLoader();
            var allProjects = loader.GetAllProjects();

            var targetProject = allProjects.FirstOrDefault(p => 
                p.Name.Equals(projectName, StringComparison.OrdinalIgnoreCase));

            if (targetProject == null)
            {
                Console.WriteLine($"Project '{projectName}' not found.");
                Console.WriteLine();
                Console.WriteLine("Available projects:");
                foreach (var p in allProjects)
                {
                    Console.WriteLine($"  - {p.Name}");
                }
                return 1;
            }

            var stateManager = new Core.SessionStateManager();
            stateManager.SetActiveProject(targetProject.Path, targetProject.Name);

            Console.WriteLine($"✓ Switched to project: {targetProject.Name}");
            Console.WriteLine($"  Path: {targetProject.Path}");

            return 0;
        }

        static int ShowActiveProject(string[] args)
        {
            var stateManager = new Core.SessionStateManager();
            var state = stateManager.GetState();

            if (string.IsNullOrEmpty(state.ActiveProjectPath))
            {
                Console.WriteLine("No active project set.");
                Console.WriteLine();
                Console.WriteLine("Switch to a project with: claudedev switch <project_name>");
                return 1;
            }

            Console.WriteLine("=== Active Project ===");
            Console.WriteLine();
            Console.WriteLine($"Name: {state.ActiveProjectName}");
            Console.WriteLine($"Path: {state.ActiveProjectPath}");
            Console.WriteLine($"Last accessed: {state.LastAccessed:yyyy-MM-dd HH:mm:ss}");
            Console.WriteLine($"Session count: {state.SessionCount}");

            return 0;
        }

        static int AutoLoadProject(string[] args)
        {
            Console.WriteLine("Auto-loading ClaudeDevStudio project...");
            Console.WriteLine();

            var loader = new Core.ContextAutoLoader();
            var result = loader.AutoLoadContext();

            if (!result.Success)
            {
                Console.WriteLine($"✗ {result.Message}");
                return 1;
            }

            Console.WriteLine($"✓ Loaded project: {result.ProjectName}");
            Console.WriteLine($"  Source: {result.Source}");
            Console.WriteLine();
            Console.WriteLine("Context:");
            Console.WriteLine("─────────────────────────────────────");
            Console.WriteLine(result.Context);

            return 0;
        }

        static string GetTimeSince(DateTime dateTime)
        {
            var span = DateTime.UtcNow - dateTime;

            if (span.TotalMinutes < 1)
                return "just now";
            if (span.TotalMinutes < 60)
                return $"{(int)span.TotalMinutes} minutes ago";
            if (span.TotalHours < 24)
                return $"{(int)span.TotalHours} hours ago";
            if (span.TotalDays < 7)
                return $"{(int)span.TotalDays} days ago";
            if (span.TotalDays < 30)
                return $"{(int)(span.TotalDays / 7)} weeks ago";
            if (span.TotalDays < 365)
                return $"{(int)(span.TotalDays / 30)} months ago";
            
            return $"{(int)(span.TotalDays / 365)} years ago";
        }

        static int BackupProject(string[] args)
        {
            var projectPath = args.Length > 1 ? args[1] : Directory.GetCurrentDirectory();
            
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            Console.WriteLine("Creating backup...");

            // Get memory path for the project
            var projectName = Path.GetFileName(projectPath.TrimEnd(Path.DirectorySeparatorChar));
            var memoryPath = SessionStateManager.GetMemoryPath(projectName);
            
            var backupManager = new Core.BackupManager(memoryPath);
            var result = backupManager.CreateBackup(Core.BackupTrigger.Manual);

            if (result.Success)
            {
                if (result.Skipped)
                {
                    Console.WriteLine($"✓ {result.Message}");
                }
                else
                {
                    Console.WriteLine($"✓ Backup created successfully");
                    Console.WriteLine($"  File: {Path.GetFileName(result.BackupPath)}");
                    Console.WriteLine($"  Size: {result.Size / 1024.0:F2} KB");
                    Console.WriteLine($"  Location: {Path.GetDirectoryName(result.BackupPath)}");
                }
                return 0;
            }
            else
            {
                Console.WriteLine($"✗ {result.Message}");
                return 1;
            }
        }

        static int RestoreBackup(string[] args)
        {
            if (args.Length < 2)
            {
                Console.WriteLine("Usage: claudedev restore <backup_file> [project_path]");
                return 1;
            }

            var backupFile = args[1];
            var projectPath = args.Length > 2 ? args[2] : Directory.GetCurrentDirectory();

            if (!File.Exists(backupFile))
                return Error($"Backup file not found: {backupFile}");

            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            Console.WriteLine("⚠️ This will restore from backup and overwrite current files.");
            Console.Write("Continue? (y/n): ");
            var confirm = Console.ReadLine()?.ToLower();

            if (confirm != "y" && confirm != "yes")
            {
                Console.WriteLine("Restore cancelled");
                return 0;
            }

            Console.WriteLine("Restoring from backup...");

            // Get memory path for the project
            var projectName = Path.GetFileName(projectPath.TrimEnd(Path.DirectorySeparatorChar));
            var memoryPath = SessionStateManager.GetMemoryPath(projectName);
            
            var backupManager = new Core.BackupManager(memoryPath);
            var result = backupManager.RestoreBackup(backupFile, createBackupFirst: true);

            if (result.Success)
            {
                Console.WriteLine($"✓ Restored {result.FilesRestored} files successfully");
                return 0;
            }
            else
            {
                Console.WriteLine($"✗ {result.Message}");
                return 1;
            }
        }

        static int ListBackups(string[] args)
        {
            var projectPath = args.Length > 1 ? args[1] : Directory.GetCurrentDirectory();
            
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            // Get memory path for the project
            var projectName = Path.GetFileName(projectPath.TrimEnd(Path.DirectorySeparatorChar));
            var memoryPath = SessionStateManager.GetMemoryPath(projectName);
            
            var backupManager = new Core.BackupManager(memoryPath);
            var backups = backupManager.ListBackups();

            if (!backups.Any())
            {
                Console.WriteLine("No backups found");
                return 0;
            }

            Console.WriteLine($"=== Backups for {projectName} ===");
            Console.WriteLine();

            foreach (var backup in backups)
            {
                var age = GetTimeSince(backup.Created);
                Console.WriteLine($"  {backup.FileName}");
                Console.WriteLine($"    Size: {backup.Size / 1024.0:F2} KB");
                Console.WriteLine($"    Created: {age}");
                Console.WriteLine();
            }

            return 0;
        }

        static int GitCommand(string[] args)
        {
            if (args.Length < 2)
            {
                Console.WriteLine("Usage: claudedev git <subcommand>");
                Console.WriteLine();
                Console.WriteLine("Subcommands:");
                Console.WriteLine("  init [remote_url]    Initialize Git repository");
                Console.WriteLine("  commit [message]     Commit current state");
                Console.WriteLine("  push [branch]        Push to remote");
                Console.WriteLine("  pull [branch]        Pull from remote");
                Console.WriteLine("  status               Show Git status");
                Console.WriteLine("  history [limit]      Show commit history");
                return 1;
            }

            var projectPath = Directory.GetCurrentDirectory();
            var subcommand = args[1].ToLower();

            if (!Core.GitSyncManager.IsGitInstalled())
            {
                Console.WriteLine("✗ Git is not installed or not in PATH");
                Console.WriteLine("  Install Git from: https://git-scm.com/download/win");
                return 1;
            }

            // Get memory path for the project
            var projectName = Path.GetFileName(projectPath.TrimEnd(Path.DirectorySeparatorChar));
            var memoryPath = SessionStateManager.GetMemoryPath(projectName);
            
            var gitSync = new Core.GitSyncManager(memoryPath);

            switch (subcommand)
            {
                case "init":
                    var remoteUrl = args.Length > 2 ? args[2] : null;
                    var initResult = gitSync.InitializeRepo(remoteUrl);
                    Console.WriteLine(initResult.Success ? $"✓ {initResult.Message}" : $"✗ {initResult.Message}");
                    return initResult.Success ? 0 : 1;

                case "commit":
                    var message = args.Length > 2 ? string.Join(" ", args.Skip(2)) : null;
                    var commitResult = gitSync.CommitChanges(message);
                    Console.WriteLine(commitResult.Success ? $"✓ {commitResult.Message}" : $"✗ {commitResult.Message}");
                    return commitResult.Success ? 0 : 1;

                case "push":
                    var pushBranch = args.Length > 2 ? args[2] : "main";
                    var pushResult = gitSync.Push(pushBranch);
                    Console.WriteLine(pushResult.Success ? $"✓ {pushResult.Message}" : $"✗ {pushResult.Message}");
                    return pushResult.Success ? 0 : 1;

                case "pull":
                    var pullBranch = args.Length > 2 ? args[2] : "main";
                    var pullResult = gitSync.Pull(pullBranch);
                    Console.WriteLine(pullResult.Success ? $"✓ {pullResult.Message}" : $"✗ {pullResult.Message}");
                    return pullResult.Success ? 0 : 1;

                case "status":
                    var status = gitSync.GetStatus();
                    Console.WriteLine($"Git Repository: {(status.IsInitialized ? "Initialized" : "Not initialized")}");
                    if (status.IsInitialized)
                    {
                        Console.WriteLine($"Has changes: {(status.HasChanges ? "Yes" : "No")}");
                        Console.WriteLine($"Has remote: {(status.HasRemote ? "Yes" : "No")}");
                        if (status.LastCommitHash != null)
                        {
                            Console.WriteLine($"Last commit: {status.LastCommitHash.Substring(0, 7)} - {status.LastCommitMessage}");
                            Console.WriteLine($"            {status.LastCommitDate:yyyy-MM-dd HH:mm:ss}");
                        }
                    }
                    return 0;

                case "history":
                    var limit = args.Length > 2 ? int.Parse(args[2]) : 10;
                    var history = gitSync.GetHistory(limit);
                    Console.WriteLine($"=== Last {history.Length} commits ===");
                    Console.WriteLine();
                    foreach (var commit in history)
                    {
                        Console.WriteLine($"{commit.Hash.Substring(0, 7)} - {commit.Message}");
                        Console.WriteLine($"  {commit.Author} - {commit.Date:yyyy-MM-dd HH:mm:ss}");
                        Console.WriteLine();
                    }
                    return 0;

                default:
                    return Error($"Unknown git subcommand: {subcommand}");
            }
        }

        static int CloudCommand(string[] args)
        {
            if (args.Length < 2)
            {
                Console.WriteLine("Usage: claudedev cloud <subcommand>");
                Console.WriteLine();
                Console.WriteLine("Subcommands:");
                Console.WriteLine("  configure <account_id> <api_token> <bucket>  Configure cloud sync");
                Console.WriteLine("  upload           Upload current state to cloud");
                Console.WriteLine("  download [file]  Download from cloud");
                Console.WriteLine("  list             List cloud backups");
                Console.WriteLine("  status           Show cloud sync status");
                return 1;
            }

            var projectPath = Directory.GetCurrentDirectory();
            var subcommand = args[1].ToLower();
            
            // Get memory path for the project
            var projectName = Path.GetFileName(projectPath.TrimEnd(Path.DirectorySeparatorChar));
            var memoryPath = SessionStateManager.GetMemoryPath(projectName);
            
            var cloudSync = new Core.CloudSyncManager(memoryPath);

            switch (subcommand)
            {
                case "configure":
                    if (args.Length < 5)
                    {
                        Console.WriteLine("Usage: claudedev cloud configure <account_id> <api_token> <bucket_name>");
                        return 1;
                    }
                    cloudSync.Configure(args[2], args[3], args[4]);
                    Console.WriteLine("✓ Cloud sync configured");
                    return 0;

                case "upload":
                    Console.WriteLine("Uploading to cloud...");
                    var uploadResult = cloudSync.UploadAsync().Result;
                    Console.WriteLine(uploadResult.Success ? $"✓ {uploadResult.Message}" : $"✗ {uploadResult.Message}");
                    return uploadResult.Success ? 0 : 1;

                case "download":
                    var fileName = args.Length > 2 ? args[2] : null;
                    Console.WriteLine("Downloading from cloud...");
                    var downloadResult = cloudSync.DownloadAsync(fileName).Result;
                    Console.WriteLine(downloadResult.Success ? $"✓ {downloadResult.Message}" : $"✗ {downloadResult.Message}");
                    return downloadResult.Success ? 0 : 1;

                case "list":
                    var backups = cloudSync.ListBackupsAsync().Result;
                    Console.WriteLine($"Found {backups.Length} cloud backup(s)");
                    foreach (var backup in backups)
                    {
                        Console.WriteLine($"  {backup.FileName} - {backup.Size / 1024.0:F2} KB");
                    }
                    return 0;

                case "status":
                    var status = cloudSync.GetStatus();
                    Console.WriteLine($"Cloud Sync: {(status.IsConfigured ? "Configured" : "Not configured")}");
                    if (status.IsConfigured)
                    {
                        Console.WriteLine($"Provider: {status.Provider}");
                        Console.WriteLine($"Last upload: {(status.LastUpload.HasValue ? GetTimeSince(status.LastUpload.Value) : "Never")}");
                        Console.WriteLine($"Last download: {(status.LastDownload.HasValue ? GetTimeSince(status.LastDownload.Value) : "Never")}");
                        Console.WriteLine($"Upload count: {status.UploadCount}");
                        Console.WriteLine($"Download count: {status.DownloadCount}");
                    }
                    return 0;

                default:
                    return Error($"Unknown cloud subcommand: {subcommand}");
            }
        }

        static int SyncProject(string[] args)
        {
            var projectPath = args.Length > 1 ? args[1] : Directory.GetCurrentDirectory();
            
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            Console.WriteLine("Synchronizing project memory...");
            Console.WriteLine();

            // Create backup first
            var backupManager = new Core.BackupManager(projectPath);
            var backupResult = backupManager.CreateBackup(Core.BackupTrigger.Manual);

            if (backupResult.Success && !backupResult.Skipped)
            {
                Console.WriteLine($"✓ Created local backup: {Path.GetFileName(backupResult.BackupPath)}");
            }

            // Try Git sync if available
            if (Core.GitSyncManager.IsGitInstalled())
            {
                var gitSync = new Core.GitSyncManager(projectPath);
                var status = gitSync.GetStatus();

                if (status.IsInitialized && status.HasChanges)
                {
                    var commitResult = gitSync.CommitChanges($"Auto-sync: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
                    if (commitResult.Success)
                    {
                        Console.WriteLine($"✓ Git: {commitResult.Message}");

                        if (status.HasRemote)
                        {
                            var pushResult = gitSync.Push();
                            Console.WriteLine(pushResult.Success ? "✓ Git: Pushed to remote" : "✗ Git: Push failed");
                        }
                    }
                }
            }

            Console.WriteLine();
            Console.WriteLine("✓ Sync complete");

            return 0;
        }

        static int ShowHelp()
        {
            Console.WriteLine($"ClaudeDevStudio v{ProductVersion}");
            Console.WriteLine("Memory & Development System for Claude AI");
            Console.WriteLine();
            Console.WriteLine("Copyright (c) 2026 Daniel E Gain");
            Console.WriteLine("Contact: support@gainpublications.com");
            Console.WriteLine("Licensed under MIT License");
            Console.WriteLine("GitHub: https://github.com/dectdan/Claude-Developer-Studio");
            Console.WriteLine();
            Console.WriteLine("Developed with assistance from Claude (Anthropic)");
            Console.WriteLine();
            Console.WriteLine("COMMANDS:");
            Console.WriteLine("  init <project_path>      Initialize memory system for a project");
            Console.WriteLine("  load <project_path>      Load context (used at session start)");
            Console.WriteLine("  record <project_path> <type> <json>");
            Console.WriteLine("                           Record an activity, pattern, mistake, decision, performance or handoff (JSON)");
            Console.WriteLine("  check <project_path> <action>");
            Console.WriteLine("                           Check if an action matches a prior mistake or a lesson for every project");
            Console.WriteLine("  lesson add <json> [--force]   Add a lesson for every project ({\"lesson\":..., \"why\":...});");
            Console.WriteLine("                           refuses an empty one or a near-duplicate. add --file <f.jsonl>: one per line");
            Console.WriteLine("  lesson list | edit <LSN###> <json> | remove <LSN###>");
            Console.WriteLine("  stats [project_path]     Show memory statistics");
            Console.WriteLine("  handoff [project_path]   Write an automatic handoff from the session state");
            Console.WriteLine("                           (never replaces one written with record ... handoff)");
            Console.WriteLine("  cleanup [project_path]   Run daily memory cleanup");
            Console.WriteLine();
            Console.WriteLine("  CLAUDE CODE (optional, off until you turn it on):");
            Console.WriteLine("  claude-code setup        Register CDS's servers and hooks with Claude Code");
            Console.WriteLine("  claude-code remove       Take out only what setup added");
            Console.WriteLine("  claude-code status       Installed, signed in, set up? And the next step");
            Console.WriteLine();
            Console.WriteLine("  PROJECT MANAGEMENT:");
            Console.WriteLine("  projects                 List all ClaudeDevStudio projects");
            Console.WriteLine("  switch <project_name>    Switch to a different project");
            Console.WriteLine("  active                   Show currently active project");
            Console.WriteLine("  autoload                 Auto-detect and load project context");
            Console.WriteLine();
            Console.WriteLine("  BACKUP & SYNC:");
            Console.WriteLine("  backup [project_path]    Create backup (OneDrive synced)");
            Console.WriteLine("  restore <file> [path]    Restore from backup");
            Console.WriteLine("  backups [project_path]   List available backups");
            Console.WriteLine("  sync [project_path]      Sync to all configured backends");
            Console.WriteLine();
            Console.WriteLine("  GIT SYNC:");
            Console.WriteLine("  git init [remote_url]    Initialize Git repository");
            Console.WriteLine("  git commit [message]     Commit current state");
            Console.WriteLine("  git push [branch]        Push to remote (default: main)");
            Console.WriteLine("  git pull [branch]        Pull from remote (default: main)");
            Console.WriteLine("  git status               Show Git status");
            Console.WriteLine("  git history [limit]      Show commit history (default: 10)");
            Console.WriteLine();
            Console.WriteLine("  CLOUD SYNC:");
            Console.WriteLine("  cloud configure <account_id> <token> <bucket>  Configure Cloudflare");
            Console.WriteLine("  cloud upload             Upload to cloud");
            Console.WriteLine("  cloud download [file]    Download from cloud");
            Console.WriteLine("  cloud list               List cloud backups");
            Console.WriteLine("  cloud status             Show cloud sync status");
            Console.WriteLine();
            Console.WriteLine("  BUILD AUTOMATION:");
            Console.WriteLine("  build <project_path>     Build project (Debug x64 by default)");
            Console.WriteLine("  package <project_path>   Create MSIX package");
            Console.WriteLine("  clean <project_path>     Clean build artifacts");
            Console.WriteLine();
            Console.WriteLine("  COMPONENT MANAGEMENT:");
            Console.WriteLine("  status                   Show status of all components");
            Console.WriteLine("  restart [all|tray|dashboard|mcp]   Restart components");
            Console.WriteLine();
            Console.WriteLine("  help                     Show this help");
            Console.WriteLine();
            Console.WriteLine("EXAMPLES:");
            Console.WriteLine("  claudedev init C:\\\\Projects\\\\MyProject");
            Console.WriteLine("  claudedev projects");
            Console.WriteLine("  claudedev switch MyProject");
            Console.WriteLine("  claudedev backup");
            Console.WriteLine("  claudedev backups");
            Console.WriteLine("  claudedev git init https://github.com/user/repo.git");
            Console.WriteLine("  claudedev git commit \"Added auth module\"");
            Console.WriteLine("  claudedev git push");
            Console.WriteLine("  claudedev sync");
            Console.WriteLine("  claudedev cloud configure account123 token456 my-bucket");
            Console.WriteLine("  claudedev cloud upload");
            Console.WriteLine();
            Console.WriteLine("For more info: https://github.com/dectdan/Claude-Developer-Studio");
            
            return 0;
        }

        #endregion

        #region Helpers

        static int Error(string message)
        {
            Console.Error.WriteLine($"Error: {message}");
            Console.Error.WriteLine("Run 'claudedev help' for usage information");
            return 1;
        }

        static long GetDirectorySize(string path)
        {
            var dirInfo = new DirectoryInfo(path);
            long size = 0;

            var files = dirInfo.GetFiles("*", SearchOption.AllDirectories);
            foreach (var file in files)
            {
                size += file.Length;
            }

            return size;
        }


        static int ConfigureClaude()
        {
            Console.WriteLine("Configuring Claude Desktop integration...");
            Console.WriteLine();

            var installDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ClaudeDevStudio");

            var mcpServerPath = Path.Combine(installDir, "mcp-server", "index.js");
            var configDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Claude");
            var configPath = Path.Combine(configDir, "claude_desktop_config.json");

            // Claude Desktop not set up yet (P5): add the entries anyway, as the installer does, so
            // a Claude Desktop installed later finds them (cds-config.js creates the file).
            var notSetUp = !Directory.Exists(configDir);
            if (notSetUp)
            {
                Console.WriteLine("Claude Desktop is not installed on this account yet; adding ClaudeDevStudio to its settings now.");
                Console.WriteLine("  Then: install Claude Desktop from https://claude.ai/download, sign in, quit it fully and reopen it once.");
                Console.WriteLine();
            }

            // Check MCP server exists
            if (!File.Exists(mcpServerPath))
            {
                Console.WriteLine($"MCP server not found at: {mcpServerPath}");
                Console.WriteLine("ClaudeDevStudio may not be installed correctly. Try reinstalling.");
                return 1;
            }

            // Find node.exe full path - Claude Desktop (Store app) cannot resolve bare "node"
            var nodePath = FindNodeExe() ?? "node";
            if (nodePath == "node")
            {
                Console.WriteLine("Node.js not found. Install Node.js LTS from https://nodejs.org, then run: claudedev configure-claude");
                return 1;
            }

            // The installer's cds-config.js adds the two CDS entries and keeps every other
            // server and setting in the file (it backs the file up first, and leaves a file
            // that isn't valid JSON untouched). Writing the file here would lose them.
            var script = Path.Combine(installDir, "cds-config.js");
            if (!File.Exists(script))
            {
                Console.WriteLine($"{script} not found. ClaudeDevStudio may not be installed correctly. Try reinstalling.");
                return 1;
            }

            var psi = new System.Diagnostics.ProcessStartInfo(nodePath)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            foreach (var arg in new[] { script, "install", "--config", configPath, "--node", nodePath,
                                        "--mcp", Path.GetDirectoryName(mcpServerPath)!,
                                        "--manual", Path.Combine(installDir, "ADD-TO-CLAUDE-CONFIG.txt") })
                psi.ArgumentList.Add(arg);

            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc == null) { Console.WriteLine("Could not start Node.js."); return 1; }
            var output = proc.StandardOutput.ReadToEnd() + proc.StandardError.ReadToEnd();
            proc.WaitForExit();
            Console.WriteLine(output.TrimEnd());
            Console.WriteLine();

            if (proc.ExitCode != 0)
            {
                Console.WriteLine("Claude Desktop's config was NOT changed (see above).");
                return 1;
            }
            Console.WriteLine(notSetUp
                ? "Done. Once Claude Desktop is installed and you are signed in, quit it fully and reopen it once to activate ClaudeDevStudio."
                : "Claude Desktop configured. Quit Claude Desktop fully and reopen it to activate ClaudeDevStudio.");
            return 0;
        }

        // node.exe in the places the installer's Node.js MSI uses (the same list as setup.nsi).
        static string? FindNodeExe()
        {
            var candidates = new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
            };
            return candidates.FirstOrDefault(File.Exists);
        }

        // claudedev claude-code setup | remove | status
        // status (from P9) starts with a State line: not-installed, too-old, not-signed-in,
        // not-set-up or ready, and the next step (the tray app reads it).
        // Registers CDS's two MCP servers with Claude Code (user scope) and adds its four
        // hooks to Claude Code's user settings, or takes out only those. The work is done by the
        // installed cds-claude-code.js (run with Node), which keeps everything else in both files,
        // backs them up first and leaves a file that isn't valid JSON untouched.
        // Anything after the action is passed to the script (e.g. --settings/--claude-json for tests).
        static int ClaudeCodeCommand(string[] args)
        {
            var action = args.Length > 1 ? args[1].ToLower() : "status";
            if (action != "setup" && action != "remove" && action != "status")
                return Error("Usage: claudedev claude-code setup | remove | status");

            var installDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeDevStudio");
            var script = Path.Combine(installDir, "cds-claude-code.js");
            var mcpDir = Path.Combine(installDir, "mcp-server");
            if (!File.Exists(script))
            {
                Console.WriteLine($"{script} not found. ClaudeDevStudio may not be installed correctly. Try reinstalling.");
                return 1;
            }
            var nodePath = FindNodeExe();
            if (nodePath == null)
            {
                Console.WriteLine("Node.js not found. Install Node.js LTS from https://nodejs.org, then run: claudedev claude-code " + action);
                return 1;
            }

            var psi = new System.Diagnostics.ProcessStartInfo(nodePath)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            foreach (var arg in new[] { script, action, "--node", nodePath, "--mcp", mcpDir })
                psi.ArgumentList.Add(arg);
            foreach (var arg in args.Skip(2))
                psi.ArgumentList.Add(arg);
            // The user's own "remove" (from P9): remembered, so the installer's default (set it up
            // when Claude Code is there) doesn't put it back on an upgrade. The uninstaller runs the
            // script itself, without this.
            if (action == "remove" && !args.Skip(2).Contains("--remember-choice"))
                psi.ArgumentList.Add("--remember-choice");

            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc == null) { Console.WriteLine("Could not start Node.js."); return 1; }
            var stderrTask = proc.StandardError.ReadToEndAsync();
            var output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit();
            var errors = stderrTask.Result;
            Console.WriteLine((output + errors).TrimEnd());
            return proc.ExitCode;
        }
        static int ShowVersion()
        {
            Console.WriteLine($"ClaudeDevStudio v{ProductVersion}");
            Console.WriteLine();
            Console.WriteLine("Copyright (c) 2026 Daniel E Gain");
            Console.WriteLine("Contact: support@gainpublications.com");
            Console.WriteLine("Licensed under MIT License");
            Console.WriteLine();
            Console.WriteLine("Developed with assistance from Claude (Anthropic)");
            Console.WriteLine();
            Console.WriteLine("GitHub: https://github.com/dectdan/Claude-Developer-Studio");
            Console.WriteLine();
            return 0;
        }

        static int UpdateCommand(string[] args)
        {
            Console.WriteLine("Checking for updates...");
            Console.WriteLine();

            try
            {
                var updateTask = UpdateChecker.CheckForUpdatesAsync();
                updateTask.Wait(); // Blocking wait is OK for CLI
                var updateInfo = updateTask.Result;

                if (updateInfo.UpdateAvailable)
                {
                    Console.WriteLine($"✓ Update Available!");
                    Console.WriteLine();
                    Console.WriteLine($"Current Version:  {updateInfo.CurrentVersion}");
                    Console.WriteLine($"Latest Version:   {updateInfo.LatestVersion}");
                    Console.WriteLine();
                    
                    if (!string.IsNullOrEmpty(updateInfo.ReleaseNotes))
                    {
                        Console.WriteLine("Release Notes:");
                        Console.WriteLine(updateInfo.ReleaseNotes);
                        Console.WriteLine();
                    }
                    
                    Console.WriteLine($"Download: {updateInfo.DownloadUrl}");
                    Console.WriteLine();
                    Console.Write("Open download page in browser? (y/n): ");
                    
                    var response = Console.ReadLine()?.Trim().ToLower();
                    if (response == "y" || response == "yes")
                    {
                        if (updateInfo.DownloadUrl != null)
                        {
                            UpdateChecker.OpenDownloadPage(updateInfo.DownloadUrl);
                            Console.WriteLine("✓ Opened in browser");
                        }
                    }
                    
                    return 0;
                }
                else
                {
                    Console.WriteLine($"✓ You're running the latest version ({updateInfo.CurrentVersion})");
                    return 0;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"✗ Failed to check for updates: {ex.Message}");
                return 1;
            }
        }

        #endregion
    }
}
