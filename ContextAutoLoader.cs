using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using ClaudeDevStudio.Memory;

namespace ClaudeDevStudio.Core
{
    /// <summary>
    /// Automatically loads project context for seamless Claude session continuity
    /// </summary>
    public class ContextAutoLoader
    {
        private readonly SessionStateManager _stateManager;

        public ContextAutoLoader()
        {
            _stateManager = new SessionStateManager();
        }

        /// <summary>
        /// Detect and load appropriate project context
        /// Returns formatted context ready for Claude consumption
        /// </summary>
        public AutoLoadResult AutoLoadContext()
        {
            // Try to find active project
            var sessionState = _stateManager.GetState();

            string? projectPath = null;
            string? projectName = null;
            string source = "unknown";

            // Priority 1: Active project from session state
            if (!string.IsNullOrEmpty(sessionState.ActiveProjectPath) && 
                Directory.Exists(sessionState.ActiveProjectPath))
            {
                projectPath = sessionState.ActiveProjectPath;
                projectName = sessionState.ActiveProjectName ?? Path.GetFileName(projectPath);
                source = "active_session";
            }
            // Priority 2: Most recently modified project
            else
            {
                var recentProject = _stateManager.GetMostRecentProject();
                if (recentProject != null)
                {
                    projectPath = recentProject.Path;
                    projectName = recentProject.Name;
                    source = "recent_activity";
                }
            }

            // No project found
            if (projectPath == null || projectName == null)
            {
                return new AutoLoadResult
                {
                    Success = false,
                    Message = "No ClaudeDevStudio projects found. Would you like to create one?"
                };
            }

            // Load project context
            try
            {
                var memory = new ClaudeMemory(projectPath);
                var context = LoadProjectContext(memory, projectPath, projectName, source);

                // Update state to mark this as active
                _stateManager.SetActiveProject(projectPath, projectName);
                _stateManager.RecordSessionStart();

                return new AutoLoadResult
                {
                    Success = true,
                    ProjectName = projectName,
                    ProjectPath = projectPath,
                    Context = context,
                    Source = source
                };
            }
            catch (Exception ex)
            {
                return new AutoLoadResult
                {
                    Success = false,
                    Message = $"Found project '{projectName}' but failed to load context: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Load all relevant context from a project
        /// </summary>
        private string LoadProjectContext(ClaudeMemory memory, string projectPath, string projectName, string source)
        {
            var sb = new StringBuilder();

            sb.AppendLine($"[ClaudeDevStudio Context Loaded: {projectName}]");
            sb.AppendLine($"Source: {source}");
            sb.AppendLine();

            // Load session state
            try
            {
                memory.LoadContext();
                var sessionState = memory.GetSessionState();

                if (sessionState.CurrentTask != null)
                {
                    sb.AppendLine("CURRENT TASK:");
                    sb.AppendLine($"  {sessionState.CurrentTask.Description}");
                    sb.AppendLine($"  Status: {sessionState.CurrentTask.Status}");
                    sb.AppendLine();

                    if (sessionState.CurrentTask.NextSteps.Any())
                    {
                        sb.AppendLine("  Next Steps:");
                        foreach (var step in sessionState.CurrentTask.NextSteps.Take(5))
                        {
                            sb.AppendLine($"    - {step}");
                        }
                        sb.AppendLine();
                    }
                }

                // Pending decisions
                if (sessionState.DecisionsPending.Any())
                {
                    sb.AppendLine("PENDING DECISIONS:");
                    foreach (var decision in sessionState.DecisionsPending.Take(3))
                    {
                        sb.AppendLine($"  ? {decision.Question}");
                        if (decision.Options.Any())
                        {
                            sb.AppendLine($"    Options: {string.Join(", ", decision.Options)}");
                        }
                    }
                    sb.AppendLine();
                }

                // Flagged uncertainties
                if (sessionState.UncertaintiesFlagged.Any())
                {
                    sb.AppendLine("FLAGGED UNCERTAINTIES:");
                    foreach (var uncertainty in sessionState.UncertaintiesFlagged.Take(3))
                    {
                        sb.AppendLine($"  ! {uncertainty}");
                    }
                    sb.AppendLine();
                }
            }
            catch
            {
                // Continue even if session state fails
            }

            // Load facts
            try
            {
                var factsPath = Path.Combine(projectPath, "FACTS.md");
                if (File.Exists(factsPath))
                {
                    var facts = File.ReadAllText(factsPath);
                    if (!string.IsNullOrWhiteSpace(facts))
                    {
                        sb.AppendLine("KEY FACTS:");
                        // Only include first 10 lines of facts to avoid overload
                        var factLines = facts.Split('\n').Take(10);
                        foreach (var line in factLines)
                        {
                            sb.AppendLine($"  {line.TrimEnd()}");
                        }
                        sb.AppendLine();
                    }
                }
            }
            catch
            {
                // Continue even if facts fail
            }

            // Load recent patterns
            try
            {
                var patternsPath = Path.Combine(projectPath, "PATTERNS.jsonl");
                if (File.Exists(patternsPath))
                {
                    var recentPatterns = File.ReadLines(patternsPath)
                        .TakeLast(5)
                        .Select(line =>
                        {
                            try
                            {
                                using var doc = JsonDocument.Parse(line);
                                var root = doc.RootElement;
                                return new
                                {
                                    Pattern = root.GetProperty("pattern").GetString(),
                                    Confidence = root.GetProperty("confidence").GetInt32(),
                                    IsAnti = root.TryGetProperty("isAntipattern", out var anti) && anti.GetBoolean()
                                };
                            }
                            catch { return null; }
                        })
                        .Where(p => p != null)
                        .ToList();

                    if (recentPatterns.Any())
                    {
                        sb.AppendLine("RECENT PATTERNS:");
                        foreach (var pattern in recentPatterns)
                        {
                            var prefix = pattern!.IsAnti ? "  -" : "  +";
                            sb.AppendLine($"{prefix} {pattern.Pattern} ({pattern.Confidence}%)");
                        }
                        sb.AppendLine();
                    }
                }
            }
            catch
            {
                // Continue even if patterns fail
            }

            // Load recent mistakes
            try
            {
                var mistakesPath = Path.Combine(projectPath, "MISTAKES.jsonl");
                if (File.Exists(mistakesPath))
                {
                    var recentMistakes = File.ReadLines(mistakesPath)
                        .TakeLast(3)
                        .Select(line =>
                        {
                            try
                            {
                                using var doc = JsonDocument.Parse(line);
                                var root = doc.RootElement;
                                return new
                                {
                                    Mistake = root.GetProperty("mistake").GetString(),
                                    Lesson = root.GetProperty("lesson").GetString()
                                };
                            }
                            catch { return null; }
                        })
                        .Where(m => m != null)
                        .ToList();

                    if (recentMistakes.Any())
                    {
                        sb.AppendLine("LESSONS LEARNED:");
                        foreach (var mistake in recentMistakes)
                        {
                            sb.AppendLine($"  ! {mistake!.Mistake}");
                            sb.AppendLine($"    -> {mistake.Lesson}");
                        }
                        sb.AppendLine();
                    }
                }
            }
            catch
            {
                // Continue even if mistakes fail
            }

            // Load recent activity
            try
            {
                var activities = memory.GetRecentActivities(10);
                if (activities.Any())
                {
                    sb.AppendLine("RECENT ACTIVITY:");
                    foreach (var activity in activities.Take(5))
                    {
                        var outcome = activity.Outcome == "success" ? "OK" : "FAILED";
                        sb.AppendLine($"  {outcome} {activity.Action}: {activity.Description}");
                    }
                    sb.AppendLine();
                }
            }
            catch
            {
                // Continue even if activity fails
            }

            sb.AppendLine("[Ready to continue development]");

            return sb.ToString();
        }

        /// <summary>
        /// Get list of all available projects
        /// </summary>
        public List<ProjectInfo> GetAllProjects()
        {
            var projects = new List<ProjectInfo>();

            try
            {
                var projectsRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    "ClaudeDevStudio",
                    "Projects");

                if (!Directory.Exists(projectsRoot))
                    return projects;

                foreach (var projectDir in Directory.GetDirectories(projectsRoot))
                {
                    var lastModified = Directory.GetLastWriteTimeUtc(projectDir);
                    
                    // Check if it has session state for better accuracy
                    var sessionStatePath = Path.Combine(projectDir, "session_state.json");
                    if (File.Exists(sessionStatePath))
                    {
                        lastModified = File.GetLastWriteTimeUtc(sessionStatePath);
                    }

                    projects.Add(new ProjectInfo
                    {
                        Name = Path.GetFileName(projectDir),
                        Path = projectDir,
                        LastAccessed = lastModified
                    });
                }

                return projects.OrderByDescending(p => p.LastAccessed).ToList();
            }
            catch
            {
                return projects;
            }
        }

        /// <summary>
        /// Check if ClaudeDevStudio is installed
        /// </summary>
        public bool IsInstalled()
        {
            try
            {
                var projectsRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    "ClaudeDevStudio",
                    "Projects");

                return Directory.Exists(projectsRoot);
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// Result of auto-loading context
    /// </summary>
    public class AutoLoadResult
    {
        public bool Success { get; set; }
        public string? ProjectName { get; set; }
        public string? ProjectPath { get; set; }
        public string? Context { get; set; }
        public string? Message { get; set; }
        public string? Source { get; set; }
    }
}
