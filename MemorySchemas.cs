using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ClaudeDevStudio.Memory
{
    /// <summary>
    /// Core data schemas for Claude's memory system.
    /// These define exactly how information is stored and retrieved.
    /// 
    /// Design principle: Optimize for QUERY speed, not write speed.
    /// Claude needs to load context fast (<5 seconds) at session start.
    /// </summary>

    #region Session State

    /// <summary>
    /// Current work state - what Claude is doing right now
    /// File: session_state.json
    /// </summary>
    public class SessionState
    {
        [JsonPropertyName("session_id")]
        public string SessionId { get; set; } = string.Empty;

        [JsonPropertyName("started")]
        public DateTime Started { get; set; }

        [JsonPropertyName("last_activity")]
        public DateTime LastActivity { get; set; }

        [JsonPropertyName("current_task")]
        public CurrentTask? CurrentTask { get; set; }

        [JsonPropertyName("context_usage")]
        public ContextUsage ContextUsage { get; set; } = new();

        [JsonPropertyName("decisions_pending")]
        public List<PendingDecision> DecisionsPending { get; set; } = new();

        [JsonPropertyName("uncertainties_flagged")]
        public List<string> UncertaintiesFlagged { get; set; } = new();
    }

    public class CurrentTask
    {
        [JsonPropertyName("description")]
        public string Description { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = "not_started"; // not_started, in_progress, blocked, completed

        [JsonPropertyName("next_steps")]
        public List<string> NextSteps { get; set; } = new();

        [JsonPropertyName("files_modified")]
        public List<string> FilesModified { get; set; } = new();

        [JsonPropertyName("files_to_modify")]
        public List<string> FilesToModify { get; set; } = new();

        [JsonPropertyName("blockers")]
        public List<string> Blockers { get; set; } = new();
    }

    public class ContextUsage
    {
        [JsonPropertyName("tokens_used")]
        public int TokensUsed { get; set; }

        [JsonPropertyName("tokens_limit")]
        public int TokensLimit { get; set; } = 200000;

        [JsonPropertyName("percentage")]
        public double Percentage => (double)TokensUsed / TokensLimit * 100;

        [JsonPropertyName("warning_threshold")]
        public int WarningThreshold { get; set; } = 150000;

        [JsonPropertyName("critical_threshold")]
        public int CriticalThreshold { get; set; } = 180000;

        [JsonPropertyName("should_handoff")]
        public bool ShouldHandoff => TokensUsed >= CriticalThreshold;
    }

    public class PendingDecision
    {
        [JsonPropertyName("question")]
        public string Question { get; set; } = string.Empty;

        [JsonPropertyName("options")]
        public List<string> Options { get; set; } = new();

        [JsonPropertyName("needs_user_input")]
        public bool NeedsUserInput { get; set; } = true;

        [JsonPropertyName("created")]
        public DateTime Created { get; set; }
    }

    #endregion

    #region Activity Logging

    /// <summary>
    /// Individual action taken by Claude
    /// File: Activity/YYYY-MM-DD.jsonl (JSON Lines format)
    /// </summary>
    public class Activity
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("action")]
        public string Action { get; set; } = string.Empty; // file_edit, build, test, search, etc

        [JsonPropertyName("description")]
        public string Description { get; set; } = string.Empty;

        [JsonPropertyName("file")]
        public string? File { get; set; }

        [JsonPropertyName("line")]
        public int? Line { get; set; }

        [JsonPropertyName("change")]
        public string? Change { get; set; }

        [JsonPropertyName("reason")]
        public string Reason { get; set; } = string.Empty;

        [JsonPropertyName("context")]
        public string Context { get; set; } = string.Empty;

        [JsonPropertyName("outcome")]
        public string? Outcome { get; set; } // success, failure, partial

        [JsonPropertyName("duration_ms")]
        public long? DurationMs { get; set; }

        [JsonPropertyName("tokens_used")]
        public int? TokensUsed { get; set; }

        [JsonPropertyName("metadata")]
        public Dictionary<string, object>? Metadata { get; set; }
    }

    #endregion

    #region Patterns

    /// <summary>
    /// Discovered patterns - what works and what doesn't
    /// File: PATTERNS.jsonl
    /// </summary>
    public class Pattern
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty; // PAT001, PAT002, ANTI001, ANTI002

        [JsonPropertyName("pattern")]
        public string PatternDescription { get; set; } = string.Empty;

        [JsonPropertyName("confidence")]
        public int Confidence { get; set; } // 0-100

        [JsonPropertyName("evidence")]
        public List<string> Evidence { get; set; } = new(); // Activity IDs that support this

        [JsonPropertyName("applies_to")]
        public List<string> AppliesTo { get; set; } = new(); // Tags: file_ops, builds, msix, etc

        [JsonPropertyName("created")]
        public DateTime Created { get; set; }

        [JsonPropertyName("last_seen")]
        public DateTime LastSeen { get; set; }

        [JsonPropertyName("occurrences")]
        public int Occurrences { get; set; }

        [JsonPropertyName("is_antipattern")]
        public bool IsAntipattern { get; set; } = false;

        [JsonPropertyName("recommended_instead")]
        public string? RecommendedInstead { get; set; }

        [JsonPropertyName("decay_rate")]
        public double DecayRate { get; set; } = 0.95; // Confidence decays if not seen

        /// <summary>
        /// Update confidence based on time since last seen
        /// </summary>
        public void UpdateConfidence()
        {
            var daysSinceLastSeen = (DateTime.Now - LastSeen).TotalDays;
            if (daysSinceLastSeen > 30)
            {
                // Decay confidence if pattern hasn't been seen in a while
                Confidence = (int)(Confidence * Math.Pow(DecayRate, daysSinceLastSeen / 30));
            }
        }
    }

    #endregion

    #region Mistakes

    /// <summary>
    /// Failed attempts and lessons learned
    /// File: MISTAKES.jsonl
    /// NEVER DELETE - these prevent repeat errors
    /// </summary>
    public class Mistake
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty; // ERR001, ERR002

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("mistake")]
        public string MistakeDescription { get; set; } = string.Empty;

        [JsonPropertyName("impact")]
        public string Impact { get; set; } = string.Empty;

        [JsonPropertyName("fix")]
        public string Fix { get; set; } = string.Empty;

        [JsonPropertyName("lesson")]
        public string Lesson { get; set; } = string.Empty;

        [JsonPropertyName("severity")]
        public string Severity { get; set; } = "medium"; // low, medium, high, critical

        [JsonPropertyName("preventable")]
        public bool Preventable { get; set; } = true;

        [JsonPropertyName("how_to_prevent")]
        public string HowToPrevent { get; set; } = string.Empty;

        [JsonPropertyName("context")]
        public Dictionary<string, object>? Context { get; set; }

        [JsonPropertyName("repeat_count")]
        public int RepeatCount { get; set; } = 0; // How many times made same mistake

        /// <summary>
        /// Check if a proposed action matches this mistake (keyword overlap; see MistakeMatching).
        /// </summary>
        public bool MatchesAction(string actionDescription) => MatchScore(actionDescription) > 0;

        /// <summary>
        /// How well a proposed action matches this mistake: the share of shared keywords,
        /// or 0 when it is not a match.
        /// </summary>
        public double MatchScore(string actionDescription) =>
            MistakeMatching.Score(actionDescription, $"{MistakeDescription} {Lesson}");
    }

    /// <summary>
    /// The keyword rule for "does this plan look like a recorded mistake".
    /// MUST STAY IN STEP with mcp-server\index.js (STOP, keywords, similarMistakes):
    /// same word pattern, same stop words, same thresholds, so the CLI and MCP agree.
    /// Words: runs of 4+ characters from [a-z0-9_.-], lower-cased, minus the stop words.
    /// A mistake's words come from its mistake + lesson. It matches when it shares at
    /// least 3 words with the plan and they make up at least 30% of the smaller word set.
    /// </summary>
    public static class MistakeMatching
    {
        public const int MinSharedWords = 3;
        public const double MinShare = 0.3;

        private static readonly HashSet<string> StopWords = new HashSet<string>(
            ("that this with from have been were into when then than they them their there these those " +
             "what which while will would should could about after before because does done just only also very more most " +
             "some such each other over same make made using used file files code instead").Split(' '));

        private static readonly Regex Word = new Regex(@"[a-z0-9_.\-]{4,}", RegexOptions.Compiled);

        public static HashSet<string> Keywords(string? text)
        {
            var words = new HashSet<string>();
            foreach (Match m in Word.Matches((text ?? string.Empty).ToLowerInvariant()))
            {
                if (!StopWords.Contains(m.Value))
                    words.Add(m.Value);
            }
            return words;
        }

        /// <summary>
        /// The share of shared keywords (shared / smaller word set), or 0 when the
        /// texts don't match under the rule above.
        /// </summary>
        public static double Score(string plan, string mistakeText)
        {
            var planWords = Keywords(plan);
            var words = Keywords(mistakeText);
            if (words.Count == 0)
                return 0;

            var shared = words.Count(w => planWords.Contains(w));
            var score = (double)shared / Math.Max(1, Math.Min(words.Count, planWords.Count));
            return shared >= MinSharedWords && score >= MinShare ? score : 0;
        }
    }

    #endregion

    #region Decisions

    /// <summary>
    /// Choices made with rationale
    /// File: DECISIONS.jsonl
    /// </summary>
    public class Decision
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty; // DEC001, DEC002

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("decision")]
        public string DecisionDescription { get; set; } = string.Empty;

        [JsonPropertyName("file")]
        public string? File { get; set; }

        [JsonPropertyName("alternatives_considered")]
        public List<string> AlternativesConsidered { get; set; } = new();

        [JsonPropertyName("chose")]
        public string Chose { get; set; } = string.Empty;

        [JsonPropertyName("reasoning")]
        public string Reasoning { get; set; } = string.Empty;

        [JsonPropertyName("outcome")]
        public string? Outcome { get; set; } // success, failure, not_yet_tested

        [JsonPropertyName("would_repeat")]
        public bool? WouldRepeat { get; set; }

        [JsonPropertyName("follow_up")]
        public string? FollowUp { get; set; }

        [JsonPropertyName("context")]
        public Dictionary<string, object>? Context { get; set; }
    }

    #endregion

    #region Handoffs

    /// <summary>
    /// Where a session stopped and what comes next.
    /// Files: HANDOFFS.jsonl (every handoff, the history) and session_handoff.md (the latest
    /// one, rendered as short markdown; claudedev_load shows it first).
    /// Source "explicit": written by Claude (record handoff, the claudedev_handoff tool).
    /// Source "auto": written by the CLI from the session state (the handoff command, or a
    /// context-usage warning). An automatic handoff never replaces an explicit one in
    /// session_handoff.md; it is still kept in HANDOFFS.jsonl.
    /// </summary>
    public class Handoff
    {
        public const string Explicit = "explicit";
        public const string Automatic = "auto";

        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty; // HND001, HND002

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("source")]
        public string Source { get; set; } = Explicit;

        [JsonPropertyName("where_i_stopped")]
        public string WhereIStopped { get; set; } = string.Empty;

        [JsonPropertyName("next_step")]
        public string NextStep { get; set; } = string.Empty;

        [JsonPropertyName("open_questions")]
        public List<string> OpenQuestions { get; set; } = new();

        [JsonPropertyName("notes")]
        public string? Notes { get; set; }
    }

    #endregion

    #region Performance

    /// <summary>
    /// Performance baselines and measurements
    /// File: PERFORMANCE.jsonl
    /// </summary>
    public class Performance
    {
        [JsonPropertyName("operation")]
        public string Operation { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("duration")]
        public double Duration { get; set; }

        [JsonPropertyName("unit")]
        public string Unit { get; set; } = "seconds"; // seconds, milliseconds, minutes

        [JsonPropertyName("context")]
        public string Context { get; set; } = string.Empty;

        [JsonPropertyName("baseline")]
        public double? Baseline { get; set; }

        [JsonPropertyName("deviation")]
        public double? Deviation => Baseline.HasValue ? Duration - Baseline.Value : null;

        [JsonPropertyName("is_outlier")]
        public bool IsOutlier => Baseline.HasValue && Deviation.HasValue && Math.Abs(Deviation.Value) > Baseline.Value * 0.5;

        [JsonPropertyName("metadata")]
        public Dictionary<string, object>? Metadata { get; set; }
    }

    #endregion

    #region Facts

    /// <summary>
    /// Verified facts about the project
    /// Used to build FACTS.md (markdown format for human readability)
    /// </summary>
    public class Fact
    {
        public string Category { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string Source { get; set; } = string.Empty; // How verified
        public DateTime DateVerified { get; set; }
        public int Confidence { get; set; } = 100; // 0-100
        public List<string> Tags { get; set; } = new();
        public bool IsStale => (DateTime.Now - DateVerified).TotalDays > 90;
    }

    #endregion

    #region Uncertainties

    /// <summary>
    /// Things Claude needs to verify
    /// Used to build UNCERTAINTIES.md
    /// </summary>
    public class Uncertainty
    {
        public string Question { get; set; } = string.Empty;
        public string Context { get; set; } = string.Empty;
        public DateTime Created { get; set; }
        public string Category { get; set; } = string.Empty; // suspected, ambiguous, unknown, to_research
        public string Impact { get; set; } = "medium"; // low, medium, high
        public List<string> NextSteps { get; set; } = new();
        public bool IsStale => (DateTime.Now - Created).TotalDays > 30;
    }

    #endregion

    #region File Digests

    /// <summary>
    /// File content cache to reduce token usage
    /// Instead of re-reading files, check if they've changed
    /// </summary>
    public class FileDigest
    {
        [JsonPropertyName("path")]
        public string Path { get; set; } = string.Empty;

        [JsonPropertyName("size")]
        public long Size { get; set; }

        [JsonPropertyName("lines")]
        public int Lines { get; set; }

        [JsonPropertyName("last_modified")]
        public DateTime LastModified { get; set; }

        [JsonPropertyName("hash")]
        public string Hash { get; set; } = string.Empty; // SHA256

        [JsonPropertyName("structure")]
        public FileStructure? Structure { get; set; }

        [JsonPropertyName("facts")]
        public List<string> Facts { get; set; } = new();

        [JsonPropertyName("last_read")]
        public DateTime LastRead { get; set; }
    }

    public class FileStructure
    {
        [JsonPropertyName("classes")]
        public List<string> Classes { get; set; } = new();

        [JsonPropertyName("methods")]
        public List<string> Methods { get; set; } = new();

        [JsonPropertyName("critical_lines")]
        public List<int> CriticalLines { get; set; } = new();

        [JsonPropertyName("imports")]
        public List<string> Imports { get; set; } = new();
    }

    #endregion

    #region Statistics

    /// <summary>
    /// Self-improvement metrics
    /// </summary>
    public class SessionMetrics
    {
        [JsonPropertyName("date")]
        public DateTime Date { get; set; }

        [JsonPropertyName("session")]
        public string Session { get; set; } = string.Empty; // morning, afternoon, evening

        [JsonPropertyName("tokens_used")]
        public int TokensUsed { get; set; }

        [JsonPropertyName("actions")]
        public int Actions { get; set; }

        [JsonPropertyName("tokens_per_action")]
        public double TokensPerAction => Actions > 0 ? (double)TokensUsed / Actions : 0;

        [JsonPropertyName("errors")]
        public int Errors { get; set; }

        [JsonPropertyName("error_rate")]
        public double ErrorRate => Actions > 0 ? (double)Errors / Actions * 100 : 0;

        [JsonPropertyName("first_attempt_success")]
        public int FirstAttemptSuccess { get; set; }

        [JsonPropertyName("first_attempt_rate")]
        public double FirstAttemptRate => Actions > 0 ? (double)FirstAttemptSuccess / Actions * 100 : 0;

        [JsonPropertyName("context_load_time_seconds")]
        public double ContextLoadTimeSeconds { get; set; }
    }

    #endregion

    #region Query Results

    /// <summary>
    /// Results returned from memory queries
    /// </summary>
    public class MistakeCheck
    {
        public bool FoundPriorAttempt { get; set; }
        public Mistake? PriorMistake { get; set; }
        public bool ShouldProceed { get; set; }
        public string Reason { get; set; } = string.Empty;
        public string? Alternative { get; set; }
    }

    public class PatternMatch
    {
        public Pattern Pattern { get; set; } = new();
        public int MatchScore { get; set; } // 0-100
        public string Recommendation { get; set; } = string.Empty;
    }

    #endregion

    #region Memory Index

    /// <summary>
    /// In-memory index for fast lookups
    /// Built at session start, kept in RAM
    /// </summary>
    public class MemoryIndex
    {
        public DateTime Built { get; set; }
        public int TotalFacts { get; set; }
        public int TotalPatterns { get; set; }
        public int TotalMistakes { get; set; }
        public int TotalDecisions { get; set; }
        public Dictionary<string, List<string>> TagIndex { get; set; } = new(); // tag -> list of IDs
        public Dictionary<string, List<string>> FileIndex { get; set; } = new(); // file -> related IDs
        public List<string> HighConfidencePatterns { get; set; } = new(); // Quick access
        public List<string> CriticalMistakes { get; set; } = new(); // Never repeat these
    }

    #endregion
}
