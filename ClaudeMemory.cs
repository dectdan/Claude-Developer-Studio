using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ClaudeDevStudio.Memory
{
    /// <summary>
    /// Where the memory store is: [Documents]\ClaudeDevStudio (Environment.SpecialFolder.MyDocuments,
    /// which follows Windows' Documents redirection). CDS_MEMORY_ROOT is for tests only
    /// (mcp-server\test\smoke.mjs, P5): a throwaway root, so tests of the machine-wide lessons never
    /// touch the real store. mcp-server\cds-paths.js reads the same variable. Normal use never sets it.
    /// </summary>
    public static class MemoryPaths
    {
        public static string Root
        {
            get
            {
                var overrideRoot = Environment.GetEnvironmentVariable("CDS_MEMORY_ROOT");
                return !string.IsNullOrWhiteSpace(overrideRoot)
                    ? Path.GetFullPath(overrideRoot)
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "ClaudeDevStudio");
            }
        }
    }

    /// <summary>
    /// Core memory system for Claude.
    /// Handles loading, storing, and querying project knowledge.
    /// 
    /// Design goals:
    /// 1. Fast session startup (<5 seconds)
    /// 2. Efficient token usage (cache file digests)
    /// 3. Automatic curation (daily cleanup)
    /// 4. Mistake prevention (check before acting)
    /// </summary>
    public class ClaudeMemory
    {
        // [Documents]\ClaudeDevStudio (MemoryPaths in Lessons.cs; CDS_MEMORY_ROOT for tests only).
        private static readonly string MEMORY_ROOT = MemoryPaths.Root;
        private const int MAX_STORAGE_MB = 10240; // 10GB

        private readonly string _projectPath;
        private readonly string _projectName;
        private readonly string _memoryPath;
        
        private SessionState _sessionState;
        private MemoryIndex _index;
        private Dictionary<string, FileDigest> _fileDigests;

        // JSON options for consistent serialization
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            WriteIndented = false,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        private static readonly JsonSerializerOptions JsonIndentedOptions = new()
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        public ClaudeMemory(string projectPath)
        {
            _projectPath = projectPath;
            _projectName = Path.GetFileName(projectPath);
            _memoryPath = Path.Combine(MEMORY_ROOT, "Projects", _projectName);

            _sessionState = new SessionState();
            _index = new MemoryIndex();
            _fileDigests = new Dictionary<string, FileDigest>();

            EnsureDirectoryStructure();
        }

        /// <summary>
        /// Initialize a new session with proper defaults
        /// Call this when creating a new project
        /// </summary>
        public void InitializeNewSession()
        {
            _sessionState = new SessionState
            {
                SessionId = $"{DateTime.Now:yyyy-MM-dd_HH-mm}",
                Started = DateTime.Now,
                LastActivity = DateTime.Now,
                ContextUsage = new ContextUsage
                {
                    TokensUsed = 0,
                    TokensLimit = 200000
                },
                DecisionsPending = new List<PendingDecision>(),
                UncertaintiesFlagged = new List<string>()
            };

            SaveSessionState();
        }

        #region Initialization

        private void EnsureDirectoryStructure()
        {
            // Create memory directory structure
            Directory.CreateDirectory(_memoryPath);
            Directory.CreateDirectory(Path.Combine(_memoryPath, "Activity"));
            Directory.CreateDirectory(Path.Combine(_memoryPath, "Archive"));
            Directory.CreateDirectory(Path.Combine(_memoryPath, "Code_Snapshots"));

            // Create empty files if they don't exist
            var factsPath = Path.Combine(_memoryPath, "FACTS.md");
            if (!File.Exists(factsPath))
            {
                File.WriteAllText(factsPath, GenerateFactsTemplate());
            }

            var uncertaintiesPath = Path.Combine(_memoryPath, "UNCERTAINTIES.md");
            if (!File.Exists(uncertaintiesPath))
            {
                File.WriteAllText(uncertaintiesPath, GenerateUncertaintiesTemplate());
            }
        }

        private string GenerateFactsTemplate()
        {
            return $@"# {_projectName} - Verified Facts
*Auto-generated - Last updated: {DateTime.Now:yyyy-MM-dd HH:mm:ss}*
*Confidence: 100% (unless noted)*

## Project Structure
- Project path: `{_projectPath}`

## Build Configuration
(Facts will be added as they are discovered and verified)

## Critical Files
(Will be populated during development)

## Known Issues
(Resolved issues tracked here)
";
        }

        private string GenerateUncertaintiesTemplate()
        {
            return $@"# {_projectName} - Uncertainties
*These need verification before acting on them*

## Suspected But Unverified
(Questions that need answers)

## Ambiguous Information
(Unclear or conflicting information)

## User Preference Unknown
(Decisions requiring user input)

## To Research
(Topics requiring investigation)
";
        }

        /// <summary>
        /// Load all context at session start
        /// Target: <5 seconds total
        /// </summary>
        public void LoadContext()
        {
            var startTime = DateTime.Now;

            // Load session state
            LoadSessionState();

            // Build in-memory index
            BuildIndex();

            // Load file digests
            LoadFileDigests();

            var loadTime = (DateTime.Now - startTime).TotalSeconds;
            Console.WriteLine($"✓ Context loaded in {loadTime:F1} seconds");

            // A load after a long gap is a new session: give it a new ID.
            var now = DateTime.Now;
            // Compared in UTC: the file may hold a local time with an offset or a UTC time.
            if (string.IsNullOrEmpty(_sessionState.SessionId) ||
                now.ToUniversalTime() - _sessionState.LastActivity.ToUniversalTime() > SessionGap)
            {
                _sessionState.SessionId = $"{now:yyyy-MM-dd_HH-mm}";
                _sessionState.Started = now;
            }

            // Update session state and save it, so the next load sees this session.
            _sessionState.LastActivity = now;
            if (_sessionState.ContextUsage != null)
            {
                _sessionState.ContextUsage.TokensUsed = 0; // Reset for new session
            }
            SaveSessionState();
        }

        // Longer than this since the last activity starts a new session on load.
        private static readonly TimeSpan SessionGap = TimeSpan.FromHours(8);

        private void LoadSessionState()
        {
            var statePath = Path.Combine(_memoryPath, "session_state.json");
            if (File.Exists(statePath))
            {
                var json = File.ReadAllText(statePath);
                _sessionState = JsonSerializer.Deserialize<SessionState>(json, JsonOptions) 
                    ?? new SessionState();
            }
            else
            {
                // New session
                _sessionState = new SessionState
                {
                    SessionId = $"{DateTime.Now:yyyy-MM-dd_HH-mm}",
                    Started = DateTime.Now,
                    LastActivity = DateTime.Now,
                    ContextUsage = new ContextUsage()
                };
            }
        }

        private void BuildIndex()
        {
            _index = new MemoryIndex
            {
                Built = DateTime.Now,
                TagIndex = new Dictionary<string, List<string>>(),
                FileIndex = new Dictionary<string, List<string>>(),
                HighConfidencePatterns = new List<string>(),
                CriticalMistakes = new List<string>()
            };

            // Index patterns
            var patternsPath = Path.Combine(_memoryPath, "PATTERNS.jsonl");
            if (File.Exists(patternsPath))
            {
                var patterns = ReadJsonLines<Pattern>(patternsPath);
                _index.TotalPatterns = patterns.Count;

                foreach (var pattern in patterns)
                {
                    if (pattern.Confidence >= 80)
                    {
                        _index.HighConfidencePatterns.Add(pattern.Id);
                    }

                    foreach (var tag in pattern.AppliesTo)
                    {
                        if (!_index.TagIndex.ContainsKey(tag))
                            _index.TagIndex[tag] = new List<string>();
                        _index.TagIndex[tag].Add(pattern.Id);
                    }
                }
            }

            // Index mistakes
            var mistakesPath = Path.Combine(_memoryPath, "MISTAKES.jsonl");
            if (File.Exists(mistakesPath))
            {
                var mistakes = ReadJsonLines<Mistake>(mistakesPath);
                _index.TotalMistakes = mistakes.Count;

                foreach (var mistake in mistakes.Where(m => m.Severity == "high" || m.Severity == "critical"))
                {
                    _index.CriticalMistakes.Add(mistake.Id);
                }
            }

            // Index decisions
            var decisionsPath = Path.Combine(_memoryPath, "DECISIONS.jsonl");
            if (File.Exists(decisionsPath))
            {
                _index.TotalDecisions = ReadJsonLines<Decision>(decisionsPath).Count;
            }
        }

        private void LoadFileDigests()
        {
            var digestPath = Path.Combine(_memoryPath, "file_digests.json");
            if (File.Exists(digestPath))
            {
                var json = File.ReadAllText(digestPath);
                _fileDigests = JsonSerializer.Deserialize<Dictionary<string, FileDigest>>(json, JsonOptions)
                    ?? new Dictionary<string, FileDigest>();
            }
        }

        #endregion

        #region Session Management

        public SessionState GetSessionState() => _sessionState;

        public void SaveSessionState()
        {
            _sessionState.LastActivity = DateTime.Now;
            var statePath = Path.Combine(_memoryPath, "session_state.json");
            var json = JsonSerializer.Serialize(_sessionState, JsonIndentedOptions);
            File.WriteAllText(statePath, json);
        }

        public void UpdateTokenUsage(int tokensUsed)
        {
            if (_sessionState.ContextUsage != null)
            {
                _sessionState.ContextUsage.TokensUsed = tokensUsed;
                SaveSessionState();

                // Check if handoff needed
                if (_sessionState.ContextUsage.ShouldHandoff)
                {
                    Console.WriteLine("⚠️ Context usage critical - handoff recommended");
                    var wrote = WriteAutomaticHandoff(out var auto);
                    Console.WriteLine(wrote
                        ? $"📄 Automatic handoff {auto.Id} written: {HandoffPath}"
                        : $"📄 Automatic handoff {auto.Id} saved in HANDOFFS.jsonl; the explicit handoff in {HandoffPath} is kept");
                }
            }
        }

        #endregion

        #region Handoffs

        // One format for every handoff (see Handoff in MemorySchemas.cs). The first line of
        // session_handoff.md says which kind it holds, so an automatic handoff can tell that
        // it must not replace an explicit one.
        private const string HandoffMarkerExplicit = "<!-- cds-handoff: explicit -->";
        private const string HandoffMarkerAuto = "<!-- cds-handoff: auto -->";

        /// <summary>session_handoff.md: the latest handoff, shown first by claudedev_load.</summary>
        public string HandoffPath => Path.Combine(_memoryPath, "session_handoff.md");

        private string HandoffHistoryPath => Path.Combine(_memoryPath, "HANDOFFS.jsonl");

        /// <summary>
        /// An explicit handoff (written by Claude): appended to HANDOFFS.jsonl and written to
        /// session_handoff.md, replacing whatever handoff was there.
        /// </summary>
        public void RecordHandoff(Handoff handoff)
        {
            handoff.Id = $"HND{NextIdNumber(HandoffHistoryPath, "HND"):D3}";
            handoff.Timestamp = DateTime.Now;
            handoff.Source = Handoff.Explicit;
            handoff.WhereIStopped = (handoff.WhereIStopped ?? string.Empty).Trim();
            handoff.NextStep = (handoff.NextStep ?? string.Empty).Trim();
            handoff.OpenQuestions = (handoff.OpenQuestions ?? new List<string>())
                .Where(q => !string.IsNullOrWhiteSpace(q)).Select(q => q.Trim()).ToList();
            handoff.Notes = string.IsNullOrWhiteSpace(handoff.Notes) ? null : handoff.Notes.Trim();

            AppendJsonLine(HandoffHistoryPath, handoff);
            File.WriteAllText(HandoffPath, RenderHandoff(handoff));
        }

        /// <summary>
        /// An automatic handoff, built from the session state. Always appended to
        /// HANDOFFS.jsonl. Written to session_handoff.md only when that file doesn't hold an
        /// explicit handoff: returns false when the explicit one was kept.
        /// </summary>
        public bool WriteAutomaticHandoff(out Handoff handoff)
        {
            handoff = BuildAutomaticHandoff();
            return RecordAutomaticHandoff(handoff);
        }

        /// <summary>
        /// An automatic handoff built by someone else (record &lt;path&gt; handoff &lt;json&gt; --auto,
        /// used by the Claude Code hook). Same rule as WriteAutomaticHandoff: always appended to
        /// HANDOFFS.jsonl; written to session_handoff.md only when that file doesn't hold an
        /// explicit handoff. Returns false when the explicit one was kept.
        /// </summary>
        public bool RecordAutomaticHandoff(Handoff handoff)
        {
            handoff.Id = $"HND{NextIdNumber(HandoffHistoryPath, "HND"):D3}";
            handoff.Timestamp = DateTime.Now;
            handoff.Source = Handoff.Automatic;
            handoff.WhereIStopped = (handoff.WhereIStopped ?? string.Empty).Trim();
            handoff.NextStep = (handoff.NextStep ?? string.Empty).Trim();
            handoff.OpenQuestions = (handoff.OpenQuestions ?? new List<string>())
                .Where(q => !string.IsNullOrWhiteSpace(q)).Select(q => q.Trim()).ToList();
            handoff.Notes = string.IsNullOrWhiteSpace(handoff.Notes) ? null : handoff.Notes.Trim();
            handoff.Origin = string.IsNullOrWhiteSpace(handoff.Origin) ? null : handoff.Origin.Trim();

            AppendJsonLine(HandoffHistoryPath, handoff);
            if (LatestHandoffIsExplicit())
                return false;

            File.WriteAllText(HandoffPath, RenderHandoff(handoff));
            return true;
        }

        private bool LatestHandoffIsExplicit()
        {
            if (!File.Exists(HandoffPath))
                return false;
            var first = File.ReadLines(HandoffPath).FirstOrDefault(l => !string.IsNullOrWhiteSpace(l));
            return first != null && first.Trim().TrimStart('﻿') == HandoffMarkerExplicit;
        }

        private Handoff BuildAutomaticHandoff()
        {
            var task = _sessionState.CurrentTask;
            var recent = GetRecentActivities(5);
            var last = recent.FirstOrDefault();

            var where = task != null && !string.IsNullOrWhiteSpace(task.Description)
                ? $"{task.Description} (status: {task.Status})"
                : last != null
                    ? $"Last recorded activity: [{last.Timestamp:HH:mm}] {last.Action}: {OneLine(last.Description, 300)}"
                    : "No task or activity was recorded in this session.";

            var next = task != null && task.NextSteps.Any()
                ? string.Join("; ", task.NextSteps)
                : "Not recorded (an automatic handoff knows only the session state): read the project's ground truth, Status and Next.";

            var questions = _sessionState.DecisionsPending.Select(d => d.Question)
                .Concat(task?.Blockers.Select(b => $"Blocker: {b}") ?? Enumerable.Empty<string>())
                .Where(q => !string.IsNullOrWhiteSpace(q))
                .ToList();

            var notes = new StringBuilder();
            if (task != null && task.FilesModified.Any())
                notes.AppendLine($"Files modified: {string.Join(", ", task.FilesModified)}");
            if (recent.Any())
            {
                notes.AppendLine("Recent activity today:");
                foreach (var a in recent)
                    notes.AppendLine($"- [{a.Timestamp:HH:mm}] {a.Action}: {OneLine(a.Description, 200)}");
            }

            return new Handoff
            {
                WhereIStopped = where,
                NextStep = next,
                OpenQuestions = questions,
                Notes = notes.Length > 0 ? notes.ToString().TrimEnd() : null
            };
        }

        private string RenderHandoff(Handoff h)
        {
            var explicitOne = h.Source == Handoff.Explicit;
            var sb = new StringBuilder();
            sb.AppendLine(explicitOne ? HandoffMarkerExplicit : HandoffMarkerAuto);
            sb.AppendLine($"# Handoff: {_projectName}");
            var kind = explicitOne ? "explicit" : $"automatic, {h.Origin ?? "from the session state"}";
            sb.AppendLine($"*Written {h.Timestamp:yyyy-MM-dd HH:mm} ({kind}) · {h.Id}*");
            sb.AppendLine();
            sb.AppendLine($"**Where I stopped:** {h.WhereIStopped}");
            sb.AppendLine();
            sb.AppendLine($"**Next step:** {h.NextStep}");
            if (h.OpenQuestions.Any())
            {
                sb.AppendLine();
                sb.AppendLine("**Open questions:**");
                foreach (var q in h.OpenQuestions)
                    sb.AppendLine($"- {q}");
            }
            if (!string.IsNullOrWhiteSpace(h.Notes))
            {
                sb.AppendLine();
                sb.AppendLine($"**Notes:** {h.Notes}");
            }
            return sb.ToString();
        }

        private static string OneLine(string? s, int max)
        {
            var t = string.Join(" ", (s ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            return t.Length > max ? t[..max] + "..." : t;
        }

        #endregion

        #region Activity Logging

        public void RecordActivity(Activity activity)
        {
            activity.Id = $"ACT{DateTime.Now:yyyyMMdd}_{Guid.NewGuid().ToString("N")[..8]}";
            activity.Timestamp = DateTime.Now;

            var todayLog = Path.Combine(_memoryPath, "Activity", $"{DateTime.Now:yyyy-MM-dd}.jsonl");
            AppendJsonLine(todayLog, activity);

            _sessionState.LastActivity = DateTime.Now;
        }

        public List<Activity> GetRecentActivities(int count)
        {
            var activities = new List<Activity>();
            var todayLog = Path.Combine(_memoryPath, "Activity", $"{DateTime.Now:yyyy-MM-dd}.jsonl");
            
            if (File.Exists(todayLog))
            {
                activities.AddRange(ReadJsonLines<Activity>(todayLog));
            }

            return activities.OrderByDescending(a => a.Timestamp).Take(count).ToList();
        }

        #endregion

        #region Pattern Management

        public void RecordPattern(Pattern pattern)
        {
            var patternsPath = Path.Combine(_memoryPath, "PATTERNS.jsonl");
            var prefix = pattern.IsAntipattern ? "ANTI" : "PAT";
            pattern.Id = $"{prefix}{NextIdNumber(patternsPath, prefix):D3}";
            pattern.Created = DateTime.Now;
            pattern.LastSeen = DateTime.Now;

            AppendJsonLine(patternsPath, pattern);

            _index.TotalPatterns++;
            if (pattern.Confidence >= 80)
            {
                _index.HighConfidencePatterns.Add(pattern.Id);
            }
        }

        public List<Pattern> FindPatterns(string actionType)
        {
            var patternsPath = Path.Combine(_memoryPath, "PATTERNS.jsonl");
            if (!File.Exists(patternsPath))
                return new List<Pattern>();

            var patterns = ReadJsonLines<Pattern>(patternsPath);
            return patterns
                .Where(p => p.AppliesTo.Contains(actionType))
                .OrderByDescending(p => p.Confidence)
                .ToList();
        }

        #endregion

        #region Mistake Tracking

        public void RecordMistake(Mistake mistake)
        {
            var mistakesPath = Path.Combine(_memoryPath, "MISTAKES.jsonl");
            mistake.Id = $"ERR{NextIdNumber(mistakesPath, "ERR"):D3}";
            mistake.Timestamp = DateTime.Now;

            AppendJsonLine(mistakesPath, mistake);

            _index.TotalMistakes++;
            if (mistake.Severity == "high" || mistake.Severity == "critical")
            {
                _index.CriticalMistakes.Add(mistake.Id);
            }
        }

        public MistakeCheck CheckForMistake(string actionDescription)
        {
            var mistakesPath = Path.Combine(_memoryPath, "MISTAKES.jsonl");
            if (!File.Exists(mistakesPath))
            {
                return new MistakeCheck { ShouldProceed = true };
            }

            // The best match: the highest share of overlapping keywords (same rule as
            // index.js similarMistakes). Equal scores: the newest mistake wins.
            var mistakes = ReadJsonLines<Mistake>(mistakesPath);
            var priorMistake = mistakes
                .Select(m => (m, score: m.MatchScore(actionDescription)))
                .Where(x => x.score > 0)
                .OrderByDescending(x => x.score)
                .ThenByDescending(x => x.m.Timestamp)
                .Select(x => x.m)
                .FirstOrDefault();

            if (priorMistake != null)
            {
                // Found a prior mistake matching this action
                priorMistake.RepeatCount++;
                return new MistakeCheck
                {
                    FoundPriorAttempt = true,
                    PriorMistake = priorMistake,
                    ShouldProceed = false,
                    Reason = $"I tried this on {priorMistake.Timestamp:yyyy-MM-dd} and it failed: {priorMistake.Impact}",
                    Alternative = priorMistake.Fix
                };
            }

            return new MistakeCheck { ShouldProceed = true };
        }

        #endregion

        #region Decision Tracking

        public void RecordDecision(Decision decision)
        {
            var decisionsPath = Path.Combine(_memoryPath, "DECISIONS.jsonl");
            decision.Id = $"DEC{NextIdNumber(decisionsPath, "DEC"):D3}";
            decision.Timestamp = DateTime.Now;

            AppendJsonLine(decisionsPath, decision);

            _index.TotalDecisions++;
        }

        #endregion

        #region Performance Tracking

        public void RecordPerformance(Performance perf)
        {
            perf.Timestamp = DateTime.Now;

            // Check for baseline
            var perfPath = Path.Combine(_memoryPath, "PERFORMANCE.jsonl");
            if (File.Exists(perfPath))
            {
                var priorPerfs = ReadJsonLines<Performance>(perfPath)
                    .Where(p => p.Operation == perf.Operation)
                    .ToList();

                if (priorPerfs.Any())
                {
                    perf.Baseline = priorPerfs.Average(p => p.Duration);
                }
            }

            AppendJsonLine(perfPath, perf);

            if (perf.IsOutlier)
            {
                Console.WriteLine($"⚠️ Performance outlier detected: {perf.Operation} took {perf.Duration}{perf.Unit} (baseline: {perf.Baseline}{perf.Unit})");
            }
        }

        public Performance? GetPerformanceBaseline(string operation)
        {
            var perfPath = Path.Combine(_memoryPath, "PERFORMANCE.jsonl");
            if (!File.Exists(perfPath))
                return null;

            var perfs = ReadJsonLines<Performance>(perfPath)
                .Where(p => p.Operation == operation)
                .ToList();

            if (!perfs.Any())
                return null;

            return new Performance
            {
                Operation = operation,
                Duration = perfs.Average(p => p.Duration),
                Unit = perfs.First().Unit,
                Context = "Baseline from historical data"
            };
        }

        #endregion

        #region File Digest Management

        public FileDigest? GetFileDigest(string filePath)
        {
            if (_fileDigests.TryGetValue(filePath, out var digest))
            {
                // Check if file has changed
                if (File.Exists(filePath))
                {
                    var fileInfo = new FileInfo(filePath);
                    if (fileInfo.LastWriteTime == digest.LastModified)
                    {
                        // File unchanged - return cached digest
                        digest.LastRead = DateTime.Now;
                        return digest;
                    }
                }
            }

            // File changed or not cached - create new digest
            return null;
        }

        public void UpdateFileDigest(string filePath, string content)
        {
            var fileInfo = new FileInfo(filePath);
            var digest = new FileDigest
            {
                Path = filePath,
                Size = fileInfo.Length,
                Lines = content.Split('\n').Length,
                LastModified = fileInfo.LastWriteTime,
                Hash = ComputeHash(content),
                LastRead = DateTime.Now,
                Facts = new List<string>()
            };

            _fileDigests[filePath] = digest;
            SaveFileDigests();
        }

        private void SaveFileDigests()
        {
            var digestPath = Path.Combine(_memoryPath, "file_digests.json");
            var json = JsonSerializer.Serialize(_fileDigests, JsonIndentedOptions);
            File.WriteAllText(digestPath, json);
        }

        private static string ComputeHash(string content)
        {
            using var sha256 = SHA256.Create();
            var bytes = Encoding.UTF8.GetBytes(content);
            var hash = sha256.ComputeHash(bytes);
            return Convert.ToBase64String(hash);
        }

        #endregion

        #region Helper Methods

        private void AppendJsonLine<T>(string filePath, T obj)
        {
            var json = JsonSerializer.Serialize(obj, JsonOptions);
            File.AppendAllText(filePath, json + Environment.NewLine);
        }

        /// <summary>
        /// The next free number for IDs of the form PREFIX### in a JSONL file: the highest
        /// existing number + 1 (1 for a new file). Reads the file itself, so it doesn't
        /// depend on the index having been built, and it continues from entries written by
        /// tools\merge-memory-stores.mjs. A line that can't be read is skipped.
        /// </summary>
        private static int NextIdNumber(string filePath, string prefix)
        {
            var max = 0;
            if (!File.Exists(filePath))
                return 1;

            foreach (var line in File.ReadLines(filePath))
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                        !doc.RootElement.TryGetProperty("id", out var idProp) ||
                        idProp.ValueKind != JsonValueKind.String)
                        continue;

                    var id = idProp.GetString() ?? string.Empty;
                    if (id.Length > prefix.Length &&
                        id.StartsWith(prefix, StringComparison.Ordinal) &&
                        id.Skip(prefix.Length).All(char.IsAsciiDigit) &&
                        int.TryParse(id.AsSpan(prefix.Length), out var n) &&
                        n > max)
                    {
                        max = n;
                    }
                }
                catch (JsonException)
                {
                    // Unreadable line: skip it.
                }
            }

            return max + 1;
        }

        private List<T> ReadJsonLines<T>(string filePath)
        {
            var results = new List<T>();
            if (!File.Exists(filePath))
                return results;

            var lines = File.ReadAllLines(filePath);
            foreach (var line in lines)
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;

                try
                {
                    var obj = JsonSerializer.Deserialize<T>(line, JsonOptions);
                    if (obj != null)
                        results.Add(obj);
                }
                catch (JsonException)
                {
                    // Skip malformed lines
                    continue;
                }
            }

            return results;
        }

        #endregion

        #region Curation

        /// <summary>
        /// Run daily memory cleanup and curation
        /// </summary>
        public MemoryCurator.CurationReport RunDailyCleanup()
        {
            var curator = new MemoryCurator(this, _memoryPath, _projectName);
            return curator.RunDailyCleanup();
        }

        #endregion
    }
}
