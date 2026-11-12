using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ClaudeDevStudio.Core
{
    /// <summary>
    /// Manages persistent state across Claude sessions via MCP server
    /// Enables seamless project continuity and auto-discovery
    /// </summary>
    public class SessionStateManager
    {
        private readonly string _stateFilePath;
        private static readonly object _lock = new object();

        // P6 (1.5.0): this state (the CLI's switch/active project) used to be
        // %APPDATA%\ClaudeDevStudio\session_state.json. When the CLI runs under the packaged (MSIX)
        // Claude Desktop, Windows writes files it creates anywhere under AppData (Roaming and Local
        // alike) into Claude's package folder instead, so the CLI saw one file from Claude and
        // another from a terminal. It now lives in the memory root, [Documents]\ClaudeDevStudio
        // (MemoryPaths.Root), which is not virtualized. If the new file doesn't exist yet, the old
        // one is copied to it once; the old file is never changed or deleted.
        public const string StateFileName = "cli_session_state.json";

        public SessionStateManager()
        {
            var root = ClaudeDevStudio.Memory.MemoryPaths.Root;
            Directory.CreateDirectory(root);
            _stateFilePath = Path.Combine(root, StateFileName);

            if (!File.Exists(_stateFilePath))
            {
                try
                {
                    var old = OldStateFilePath();
                    if (File.Exists(old)) File.Copy(old, _stateFilePath, overwrite: false);
                }
                catch { /* no old state, or it can't be read: start empty */ }
            }
        }

        /// <summary>
        /// Where versions before 1.5.0 kept the state: %APPDATA%\ClaudeDevStudio\session_state.json
        /// (APPDATA as the process sees it, so a test can point it at a throwaway folder).
        /// </summary>
        public static string OldStateFilePath()
        {
            var appData = Environment.GetEnvironmentVariable("APPDATA");
            if (string.IsNullOrWhiteSpace(appData))
                appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, "ClaudeDevStudio", "session_state.json");
        }

        /// <summary>
        /// Get current session state (active project, last access, etc.)
        /// </summary>
        public SessionState GetState()
        {
            lock (_lock)
            {
                try
                {
                    if (!File.Exists(_stateFilePath))
                    {
                        return new SessionState();
                    }

                    var json = File.ReadAllText(_stateFilePath);
                    return JsonSerializer.Deserialize<SessionState>(json) ?? new SessionState();
                }
                catch
                {
                    return new SessionState();
                }
            }
        }

        /// <summary>
        /// Set the active project (called when user starts working on a project)
        /// </summary>
        public void SetActiveProject(string projectPath, string projectName)
        {
            lock (_lock)
            {
                var state = GetState();
                state.ActiveProjectPath = projectPath;
                state.ActiveProjectName = projectName;
                state.LastAccessed = DateTime.UtcNow;
                state.SessionCount++;

                SaveState(state);
            }
        }

        /// <summary>
        /// Record that a Claude session started
        /// </summary>
        public void RecordSessionStart()
        {
            lock (_lock)
            {
                var state = GetState();
                state.LastSessionStart = DateTime.UtcNow;
                state.TotalSessions++;
                SaveState(state);
            }
        }

        /// <summary>
        /// Update session with context handoff location
        /// </summary>
        public void SetHandoffPath(string handoffPath)
        {
            lock (_lock)
            {
                var state = GetState();
                state.HandoffPath = handoffPath;
                state.LastHandoffGenerated = DateTime.UtcNow;
                SaveState(state);
            }
        }

        /// <summary>
        /// Get the most recently active project across all projects
        /// </summary>
        public ProjectInfo? GetMostRecentProject()
        {
            try
            {
                var projectsRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    "ClaudeDevStudio",
                    "Projects");

                if (!Directory.Exists(projectsRoot))
                    return null;

                string? mostRecentPath = null;
                DateTime mostRecentTime = DateTime.MinValue;

                foreach (var projectDir in Directory.GetDirectories(projectsRoot))
                {
                    var sessionStatePath = Path.Combine(projectDir, "session_state.json");
                    if (File.Exists(sessionStatePath))
                    {
                        var modified = File.GetLastWriteTimeUtc(sessionStatePath);
                        if (modified > mostRecentTime)
                        {
                            mostRecentTime = modified;
                            mostRecentPath = projectDir;
                        }
                    }
                }

                if (mostRecentPath == null)
                {
                    // No session states found, use most recently modified directory
                    foreach (var projectDir in Directory.GetDirectories(projectsRoot))
                    {
                        var modified = Directory.GetLastWriteTimeUtc(projectDir);
                        if (modified > mostRecentTime)
                        {
                            mostRecentTime = modified;
                            mostRecentPath = projectDir;
                        }
                    }
                }

                if (mostRecentPath != null)
                {
                    return new ProjectInfo
                    {
                        Name = Path.GetFileName(mostRecentPath),
                        Path = mostRecentPath,
                        LastAccessed = mostRecentTime
                    };
                }

                return null;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Clear active project (user switched or session ended)
        /// </summary>
        public void ClearActiveProject()
        {
            lock (_lock)
            {
                var state = GetState();
                state.ActiveProjectPath = null;
                state.ActiveProjectName = null;
                SaveState(state);
            }
        }

        private void SaveState(SessionState state)
        {
            try
            {
                var json = JsonSerializer.Serialize(state, new JsonSerializerOptions
                {
                    WriteIndented = true
                });
                File.WriteAllText(_stateFilePath, json);
            }
            catch
            {
                // Silently fail - don't crash if we can't save state
            }
        }

        /// <summary>
        /// Get the memory path for a project (static helper)
        /// </summary>
        public static string GetMemoryPath(string projectName)
        {
            var baseMemoryPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "ClaudeDevStudio",
                "Projects"
            );

            var projectPath = Path.Combine(baseMemoryPath, projectName);
            
            // Ensure directory exists
            if (!Directory.Exists(projectPath))
            {
                Directory.CreateDirectory(projectPath);
            }

            return projectPath;
        }
    }

    /// <summary>
    /// Persistent session state
    /// </summary>
    public class SessionState
    {
        /// <summary>
        /// Path to the currently active project
        /// </summary>
        public string? ActiveProjectPath { get; set; }

        /// <summary>
        /// Name of the currently active project
        /// </summary>
        public string? ActiveProjectName { get; set; }

        /// <summary>
        /// When the project was last accessed
        /// </summary>
        public DateTime? LastAccessed { get; set; }

        /// <summary>
        /// When the last Claude session started
        /// </summary>
        public DateTime? LastSessionStart { get; set; }

        /// <summary>
        /// Path to the latest session handoff document
        /// </summary>
        public string? HandoffPath { get; set; }

        /// <summary>
        /// When the last handoff was generated
        /// </summary>
        public DateTime? LastHandoffGenerated { get; set; }

        /// <summary>
        /// Total number of sessions across this project
        /// </summary>
        public int SessionCount { get; set; }

        /// <summary>
        /// Total number of Claude sessions ever started
        /// </summary>
        public int TotalSessions { get; set; }

        /// <summary>
        /// Whether ClaudeDevStudio has been initialized
        /// </summary>
        public bool IsInitialized { get; set; }
    }

    /// <summary>
    /// Project information for discovery
    /// </summary>
    public class ProjectInfo
    {
        public string Name { get; set; } = string.Empty;
        public string Path { get; set; } = string.Empty;
        public DateTime LastAccessed { get; set; }
    }
}
