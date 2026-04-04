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
    ///   claudedev record <type> <data>       Record activity/pattern/mistake/etc
    ///   claudedev check <action>             Check if action matches prior mistake
    ///   claudedev stats                      Show memory statistics
    ///   claudedev handoff                    Generate session handoff document
    ///   claudedev cleanup                    Run daily memory cleanup
    ///   claudedev monitor <project_path>     Monitor Visual Studio debug output
    ///   claudedev build <project_path>       Build project
    ///   claudedev package <project_path>     Create MSIX package
    ///   claudedev clean <project_path>       Clean build artifacts
    /// </summary>
    class Program
    {
        static int Main(string[] args)
        {
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

            var memoryLocation = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "ClaudeDevStudio",
                "Projects",
                Path.GetFileName(projectPath)
            );

            Console.WriteLine($"âœ“ Initialized ClaudeDevStudio memory for: {Path.GetFileName(projectPath)}");
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
                Console.WriteLine($"\nâš ï¸ Pending Decisions: {state.DecisionsPending.Count}");
                foreach (var decision in state.DecisionsPending)
                {
                    Console.WriteLine($"  - {decision.Question}");
                }
            }

            if (state.UncertaintiesFlagged.Any())
            {
                Console.WriteLine($"\nâ“ Flagged Uncertainties: {state.UncertaintiesFlagged.Count}");
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
                Console.WriteLine("Types: activity, pattern, mistake, decision, performance");
                return 1;
            }

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var type = args[2].ToLower();
            var jsonData = string.Join(" ", args.Skip(3));

            var memory = new ClaudeMemory(projectPath);

            switch (type)
            {
                case "activity":
                    var activity = System.Text.Json.JsonSerializer.Deserialize<Activity>(jsonData);
                    if (activity != null)
                    {
                        memory.RecordActivity(activity);
                        Console.WriteLine($"âœ“ Recorded activity: {activity.Action}");
                    }
                    break;

                case "pattern":
                    var pattern = System.Text.Json.JsonSerializer.Deserialize<Pattern>(jsonData);
                    if (pattern != null)
                    {
                        memory.RecordPattern(pattern);
                        Console.WriteLine($"âœ“ Recorded pattern: {pattern.PatternDescription}");
                    }
                    break;

                case "mistake":
                    var mistake = System.Text.Json.JsonSerializer.Deserialize<Mistake>(jsonData);
                    if (mistake != null)
                    {
                        memory.RecordMistake(mistake);
                        Console.WriteLine($"âœ“ Recorded mistake: {mistake.MistakeDescription}");
                    }
                    break;

                case "decision":
                    var decision = System.Text.Json.JsonSerializer.Deserialize<Decision>(jsonData);
                    if (decision != null)
                    {
                        memory.RecordDecision(decision);
                        Console.WriteLine($"âœ“ Recorded decision: {decision.DecisionDescription}");
                    }
                    break;

                case "performance":
                    var perf = System.Text.Json.JsonSerializer.Deserialize<Performance>(jsonData);
                    if (perf != null)
                    {
                        memory.RecordPerformance(perf);
                        Console.WriteLine($"âœ“ Recorded performance: {perf.Operation} = {perf.Duration}{perf.Unit}");
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

            if (check.FoundPriorAttempt && check.PriorMistake != null)
            {
                Console.WriteLine("âš ï¸ WARNING: This action matches a prior mistake!");
                Console.WriteLine($"\nMistake ID: {check.PriorMistake.Id}");
                Console.WriteLine($"Date: {check.PriorMistake.Timestamp:yyyy-MM-dd}");
                Console.WriteLine($"What happened: {check.PriorMistake.Impact}");
                Console.WriteLine($"Lesson learned: {check.PriorMistake.Lesson}");
                Console.WriteLine($"\nRecommended alternative: {check.Alternative}");
                
                return 1;
            }
            else
            {
                Console.WriteLine("âœ“ No prior mistakes found for this action");
                return 0;
            }
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
                    Console.WriteLine("  âš ï¸ CRITICAL - Handoff recommended!");
                }
                else if (state.ContextUsage.TokensUsed > state.ContextUsage.WarningThreshold)
                {
                    Console.WriteLine("  âš ï¸ WARNING - Approaching context limit");
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

            var memoryPath = Path.Combine(@"C:\Users\Dan\Documents\ClaudeDevStudio\Projects", Path.GetFileName(projectPath));
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
            
            memory.UpdateTokenUsage(200000);
            
            var handoffPath = Path.Combine(
                @"C:\Users\Dan\Documents\ClaudeDevStudio\Projects",
                Path.GetFileName(projectPath),
                "session_handoff.md"
            );

            if (File.Exists(handoffPath))
            {
                Console.WriteLine($"âœ“ Handoff document generated:");
                Console.WriteLine($"  {handoffPath}");
                Console.WriteLine();
                Console.WriteLine(File.ReadAllText(handoffPath));
            }
            else
            {
                return Error("Failed to generate handoff document");
            }

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

        static int MonitorDebug(string[] args)
        {
            if (args.Length < 2)
                return Error("Usage: claudedev monitor <project_path>");

            var projectPath = args[1];
            if (!Directory.Exists(projectPath))
                return Error($"Project path does not exist: {projectPath}");

            var memory = new ClaudeMemory(projectPath);
            var monitor = new VSDebugMonitor(projectPath, memory);

            Console.WriteLine("Starting VS Debug Monitor...");
            Console.WriteLine("This will capture exceptions and errors from Visual Studio debugger.");
            Console.WriteLine();

            var monitorTask = monitor.StartMonitoringAsync();
            
            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                monitor.StopMonitoring();
            };

            monitorTask.Wait();

            return 0;
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
                    Console.WriteLine("âœ“ All components restarted");
                    break;

                case "tray":
                    if (Core.ComponentManager.RestartTrayApp())
                        Console.WriteLine("âœ“ Tray app restarted");
                    else
                        Console.WriteLine("âœ— Failed to restart tray app");
                    break;

                case "dashboard":
                    if (Core.ComponentManager.RestartDashboard())
                        Console.WriteLine("âœ“ Dashboard restarted");
                    else
                        Console.WriteLine("âœ— Failed to restart dashboard");
                    break;

                case "mcp":
                    if (Core.ComponentManager.RestartMcpServer())
                        Console.WriteLine("âœ“ MCP server restarted");
                    else
                        Console.WriteLine("âœ— Failed to restart MCP server");
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
            Console.WriteLine($"Tray App:    {(status.TrayAppRunning ? "âœ“ Running" : "âœ— Stopped")}");
            Console.WriteLine($"Dashboard:   {(status.DashboardRunning ? "âœ“ Running" : "âœ— Stopped")}");
            Console.WriteLine($"MCP Server:  {(status.McpServerRunning ? "âœ“ Running" : "âœ— Stopped")}");
            Console.WriteLine();

            if (status.AllRunning)
            {
                Console.WriteLine("All components are running âœ“");
            }
            else
            {
                Console.WriteLine("âš ï¸ Some components are not running");
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
                var marker = isActive ? "â†’" : " ";
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

            Console.WriteLine($"âœ“ Switched to project: {targetProject.Name}");
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
                Console.WriteLine($"âœ— {result.Message}");
                return 1;
            }

            Console.WriteLine($"âœ“ Loaded project: {result.ProjectName}");
            Console.WriteLine($"  Source: {result.Source}");
            Console.WriteLine();
            Console.WriteLine("Context:");
            Console.WriteLine("â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€");
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
                    Console.WriteLine($"âœ“ {result.Message}");
                }
                else
                {
                    Console.WriteLine($"âœ“ Backup created successfully");
                    Console.WriteLine($"  File: {Path.GetFileName(result.BackupPath)}");
                    Console.WriteLine($"  Size: {result.Size / 1024.0:F2} KB");
                    Console.WriteLine($"  Location: {Path.GetDirectoryName(result.BackupPath)}");
                }
                return 0;
            }
            else
            {
                Console.WriteLine($"âœ— {result.Message}");
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

            Console.WriteLine("âš ï¸ This will restore from backup and overwrite current files.");
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
                Console.WriteLine($"âœ“ Restored {result.FilesRestored} files successfully");
                return 0;
            }
            else
            {
                Console.WriteLine($"âœ— {result.Message}");
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
                Console.WriteLine("âœ— Git is not installed or not in PATH");
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
                    Console.WriteLine(initResult.Success ? $"âœ“ {initResult.Message}" : $"âœ— {initResult.Message}");
                    return initResult.Success ? 0 : 1;

                case "commit":
                    var message = args.Length > 2 ? string.Join(" ", args.Skip(2)) : null;
                    var commitResult = gitSync.CommitChanges(message);
                    Console.WriteLine(commitResult.Success ? $"âœ“ {commitResult.Message}" : $"âœ— {commitResult.Message}");
                    return commitResult.Success ? 0 : 1;

                case "push":
                    var pushBranch = args.Length > 2 ? args[2] : "main";
                    var pushResult = gitSync.Push(pushBranch);
                    Console.WriteLine(pushResult.Success ? $"âœ“ {pushResult.Message}" : $"âœ— {pushResult.Message}");
                    return pushResult.Success ? 0 : 1;

                case "pull":
                    var pullBranch = args.Length > 2 ? args[2] : "main";
                    var pullResult = gitSync.Pull(pullBranch);
                    Console.WriteLine(pullResult.Success ? $"âœ“ {pullResult.Message}" : $"âœ— {pullResult.Message}");
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
                    Console.WriteLine("âœ“ Cloud sync configured");
                    return 0;

                case "upload":
                    Console.WriteLine("Uploading to cloud...");
                    var uploadResult = cloudSync.UploadAsync().Result;
                    Console.WriteLine(uploadResult.Success ? $"âœ“ {uploadResult.Message}" : $"âœ— {uploadResult.Message}");
                    return uploadResult.Success ? 0 : 1;

                case "download":
                    var fileName = args.Length > 2 ? args[2] : null;
                    Console.WriteLine("Downloading from cloud...");
                    var downloadResult = cloudSync.DownloadAsync(fileName).Result;
                    Console.WriteLine(downloadResult.Success ? $"âœ“ {downloadResult.Message}" : $"âœ— {downloadResult.Message}");
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
                Console.WriteLine($"âœ“ Created local backup: {Path.GetFileName(backupResult.BackupPath)}");
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
                        Console.WriteLine($"âœ“ Git: {commitResult.Message}");

                        if (status.HasRemote)
                        {
                            var pushResult = gitSync.Push();
                            Console.WriteLine(pushResult.Success ? "âœ“ Git: Pushed to remote" : "âœ— Git: Push failed");
                        }
                    }
                }
            }

            Console.WriteLine();
            Console.WriteLine("âœ“ Sync complete");

            return 0;
        }

        static int ShowHelp()
        {
            Console.WriteLine("ClaudeDevStudio v1.1.0");
            Console.WriteLine("Memory & Development System for Claude AI");
            Console.WriteLine();
            Console.WriteLine("Copyright (c) 2026 Daniel E Gain");
            Console.WriteLine("Email: danielegain@gmail.com");
            Console.WriteLine("Licensed under MIT License");
            Console.WriteLine("GitHub: https://github.com/dectdan/Claude-Developer-Studio");
            Console.WriteLine();
            Console.WriteLine("Developed with assistance from Claude (Anthropic)");
            Console.WriteLine();
            Console.WriteLine("COMMANDS:");
            Console.WriteLine("  init <project_path>      Initialize memory system for a project");
            Console.WriteLine("  load <project_path>      Load context (used at session start)");
            Console.WriteLine("  record <type> <data>     Record activity/pattern/mistake (JSON format)");
            Console.WriteLine("  check <action>           Check if action matches prior mistake");
            Console.WriteLine("  stats [project_path]     Show memory statistics");
            Console.WriteLine("  handoff [project_path]   Generate session handoff document");
            Console.WriteLine("  cleanup [project_path]   Run daily memory cleanup");
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
            Console.WriteLine("  monitor <project_path>   Monitor Visual Studio debug output");
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

            // Check Claude Desktop is installed
            if (!Directory.Exists(configDir))
            {
                Console.WriteLine("Claude Desktop not found.");
                Console.WriteLine("  Install from: https://claude.ai/download");
                Console.WriteLine("  Then run: claudedev configure-claude");
                return 1;
            }

            // Check MCP server exists
            if (!File.Exists(mcpServerPath))
            {
                Console.WriteLine($"MCP server not found at: {mcpServerPath}");
                Console.WriteLine("ClaudeDevStudio may not be installed correctly. Try reinstalling.");
                return 1;
            }

            // Read or create config
            string rawConfig = File.Exists(configPath)
                ? File.ReadAllText(configPath, System.Text.Encoding.UTF8)
                : "{}";

            var config = System.Text.Json.JsonDocument.Parse(rawConfig).RootElement;
            var configObj = new System.Collections.Generic.Dictionary<string, object>();

            // Copy existing top-level keys
            foreach (var prop in config.EnumerateObject())
            {
                if (prop.Name != "mcpServers")
                    configObj[prop.Name] = prop.Value;
            }

            // Build mcpServers section
            var mcpServers = new System.Collections.Generic.Dictionary<string, object>();
            if (config.TryGetProperty("mcpServers", out var existingMcp))
            {
                foreach (var server in existingMcp.EnumerateObject())
                {
                    if (server.Name != "claudedevstudio")
                        mcpServers[server.Name] = server.Value;
                }
            }

            mcpServers["claudedevstudio"] = new
            {
                command = "node",
                args = new[] { mcpServerPath }
            };

            configObj["mcpServers"] = mcpServers;

            // Write back
            var options = new System.Text.Json.JsonSerializerOptions { WriteIndented = true };
            var json = System.Text.Json.JsonSerializer.Serialize(configObj, options);
            Directory.CreateDirectory(configDir);
            File.WriteAllText(configPath, json, System.Text.Encoding.UTF8);

            Console.WriteLine("Claude Desktop configured successfully!");
            Console.WriteLine($"  Config: {configPath}");
            Console.WriteLine($"  MCP Server: {mcpServerPath}");
            Console.WriteLine();
            Console.WriteLine("Restart Claude Desktop to activate ClaudeDevStudio.");
            return 0;
        }
        static int ShowVersion()
        {
            Console.WriteLine("ClaudeDevStudio v1.1.0");
            Console.WriteLine();
            Console.WriteLine("Copyright (c) 2026 Daniel E Gain");
            Console.WriteLine("Email: danielegain@gmail.com");
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
                    Console.WriteLine($"âœ“ Update Available!");
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
                            Console.WriteLine("âœ“ Opened in browser");
                        }
                    }
                    
                    return 0;
                }
                else
                {
                    Console.WriteLine($"âœ“ You're running the latest version ({updateInfo.CurrentVersion})");
                    return 0;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"âœ— Failed to check for updates: {ex.Message}");
                return 1;
            }
        }

        #endregion
    }
}
