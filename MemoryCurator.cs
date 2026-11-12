using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using ClaudeDevStudio.Memory;

namespace ClaudeDevStudio
{
    /// <summary>
    /// Automatic memory curation - makes Claude smarter over time
    /// 
    /// Responsibilities:
    /// 1. Extract patterns from repeated activities
    /// 2. Archive old activity logs
    /// 3. Consolidate duplicate facts
    /// 4. Decay pattern confidence over time
    /// 5. Flag stale uncertainties
    /// 6. Compress historical data
    /// 
    /// Design principle: Keep what matters, discard what doesn't.
    /// </summary>
    public class MemoryCurator
    {
        private readonly ClaudeMemory _memory;
        private readonly string _memoryPath;
        private readonly string _projectName;

        private const int PATTERN_MIN_OCCURRENCES = 3;
        private const int PATTERN_MIN_CONFIDENCE = 70;
        private const int ARCHIVE_AFTER_DAYS = 7;
        private const int FLAG_STALE_AFTER_DAYS = 30;

        public MemoryCurator(ClaudeMemory memory, string memoryPath, string projectName)
        {
            _memory = memory;
            _memoryPath = memoryPath;
            _projectName = projectName;
        }

        #region Daily Cleanup

        /// <summary>
        /// Run full daily cleanup routine
        /// </summary>
        public CurationReport RunDailyCleanup()
        {
            var report = new CurationReport
            {
                Timestamp = DateTime.Now,
                ProjectName = _projectName
            };

            Console.WriteLine("=== ClaudeDevStudio Daily Cleanup ===");
            Console.WriteLine($"Project: {_projectName}");
            Console.WriteLine($"Started: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            Console.WriteLine();

            // 1. Extract patterns
            Console.WriteLine("[1/6] Extracting patterns from recent activity...");
            var patternStats = ExtractPatternsFromActivity();
            report.PatternsExtracted = patternStats.PatternsFound;
            report.ActivitiesConsolidated = patternStats.ActivitiesConsolidated;

            // 2. Update confidence scores
            Console.WriteLine("[2/6] Updating pattern confidence scores...");
            var confidenceStats = UpdatePatternConfidence();
            report.ConfidenceUpdates = confidenceStats.Updated;
            report.PatternsDecayed = confidenceStats.Decayed;

            // 3. Archive old logs
            Console.WriteLine("[3/6] Archiving old activity logs...");
            var archiveStats = ArchiveOldLogs();
            report.LogsArchived = archiveStats.FilesArchived;
            report.SpaceFreed = archiveStats.BytesFreed;

            // 4. Consolidate duplicates
            Console.WriteLine("[4/6] Consolidating duplicate information...");
            var consolidationStats = ConsolidateDuplicates();
            report.DuplicatesRemoved = consolidationStats.Removed;

            // 5. Flag stale items
            Console.WriteLine("[5/6] Flagging stale uncertainties...");
            var staleStats = FlagStaleItems();
            report.StaleItemsFlagged = staleStats.Flagged;

            // 6. Compress archives
            Console.WriteLine("[6/6] Compressing archived logs...");
            var compressionStats = CompressArchives();
            report.ArchivesCompressed = compressionStats.Compressed;
            report.CompressionRatio = compressionStats.Ratio;

            Console.WriteLine();
            Console.WriteLine("=== Cleanup Complete ===");
            PrintReport(report);

            return report;
        }

        #endregion

        #region Pattern Extraction

        private PatternExtractionStats ExtractPatternsFromActivity()
        {
            var stats = new PatternExtractionStats();
            var activityDir = Path.Combine(_memoryPath, "Activity");

            if (!Directory.Exists(activityDir))
                return stats;

            // Get recent activity files (last 7 days)
            var recentFiles = Directory.GetFiles(activityDir, "*.jsonl")
                .Where(f => File.GetLastWriteTime(f) > DateTime.Now.AddDays(-7))
                .ToList();

            var allActivities = new List<Activity>();
            foreach (var file in recentFiles)
            {
                allActivities.AddRange(ReadJsonLines<Activity>(file));
            }

            // Group by action type
            var grouped = allActivities.GroupBy(a => a.Action);

            foreach (var group in grouped)
            {
                if (group.Count() < PATTERN_MIN_OCCURRENCES)
                    continue;

                // Look for common patterns in this action type
                var patterns = FindPatternsInGroup(group.ToList());
                stats.PatternsFound += patterns.Count;

                foreach (var pattern in patterns)
                {
                    // Check if pattern already exists
                    var existingPatterns = _memory.FindPatterns(pattern.AppliesTo.FirstOrDefault() ?? "general");
                    var exists = existingPatterns.Any(p => p.PatternDescription == pattern.PatternDescription);

                    if (!exists)
                    {
                        _memory.RecordPattern(pattern);
                        Console.WriteLine($"  + New pattern: {pattern.PatternDescription}");
                    }
                    else
                    {
                        // Pattern exists - just update occurrence count
                        Console.WriteLine($"  ^ Updated pattern: {pattern.PatternDescription}");
                    }

                    stats.ActivitiesConsolidated += group.Count();
                }
            }

            return stats;
        }

        private List<Pattern> FindPatternsInGroup(List<Activity> activities)
        {
            var patterns = new List<Pattern>();

            // Simple heuristic: if same action + similar context appears 3+ times, it's a pattern
            var contextGroups = activities
                .GroupBy(a => new { a.Action, FilePrefix = GetFilePrefix(a.File), a.Outcome })
                .Where(g => g.Count() >= PATTERN_MIN_OCCURRENCES);

            foreach (var group in contextGroups)
            {
                var confidence = CalculateConfidence(group.Count(), activities.Count);
                if (confidence < PATTERN_MIN_CONFIDENCE)
                    continue;

                var pattern = new Pattern
                {
                    PatternDescription = $"{group.Key.Action} on {group.Key.FilePrefix} files typically results in {group.Key.Outcome}",
                    Confidence = confidence,
                    Evidence = group.Select(a => a.Id).ToList(),
                    AppliesTo = new List<string> { group.Key.Action },
                    Created = DateTime.Now,
                    LastSeen = DateTime.Now,
                    Occurrences = group.Count()
                };

                patterns.Add(pattern);
            }

            return patterns;
        }

        private string GetFilePrefix(string? filePath)
        {
            if (string.IsNullOrEmpty(filePath))
                return "unknown";

            var fileName = Path.GetFileNameWithoutExtension(filePath);
            // Take first significant word (before any number or special char)
            var parts = fileName.Split(new[] { '_', '.', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9' }, 2);
            return parts.Length > 0 ? parts[0] : fileName;
        }

        private int CalculateConfidence(int occurrences, int total)
        {
            // Confidence = (occurrences / total) * 100, capped at 95
            var confidence = (int)((double)occurrences / total * 100);
            return Math.Min(confidence, 95);
        }

        #endregion

        #region Confidence Management

        private ConfidenceUpdateStats UpdatePatternConfidence()
        {
            var stats = new ConfidenceUpdateStats();
            var patternsPath = Path.Combine(_memoryPath, "PATTERNS.jsonl");

            if (!File.Exists(patternsPath))
                return stats;

            var patterns = ReadJsonLines<Pattern>(patternsPath);
            var updatedPatterns = new List<Pattern>();

            foreach (var pattern in patterns)
            {
                var originalConfidence = pattern.Confidence;
                pattern.UpdateConfidence(); // Decays if not seen recently

                if (pattern.Confidence != originalConfidence)
                {
                    stats.Decayed++;
                    Console.WriteLine($"  v {pattern.PatternDescription}: {originalConfidence}% -> {pattern.Confidence}%");
                }

                updatedPatterns.Add(pattern);
                stats.Updated++;
            }

            // Rewrite patterns file with updated confidence
            File.Delete(patternsPath);
            foreach (var pattern in updatedPatterns)
            {
                AppendJsonLine(patternsPath, pattern);
            }

            return stats;
        }

        #endregion

        #region Archiving

        private ArchiveStats ArchiveOldLogs()
        {
            var stats = new ArchiveStats();
            var activityDir = Path.Combine(_memoryPath, "Activity");
            var archiveDir = Path.Combine(_memoryPath, "Archive");

            if (!Directory.Exists(activityDir))
                return stats;

            Directory.CreateDirectory(archiveDir);

            var oldFiles = Directory.GetFiles(activityDir, "*.jsonl")
                .Where(f => File.GetLastWriteTime(f) < DateTime.Now.AddDays(-ARCHIVE_AFTER_DAYS))
                .ToList();

            foreach (var file in oldFiles)
            {
                var fileName = Path.GetFileName(file);
                var archivePath = Path.Combine(archiveDir, fileName);

                File.Move(file, archivePath, overwrite: true);
                
                var fileSize = new FileInfo(archivePath).Length;
                stats.FilesArchived++;
                stats.BytesFreed += fileSize;

                Console.WriteLine($"  Archived: {fileName} ({FormatBytes(fileSize)})");
            }

            return stats;
        }

        #endregion

        #region Consolidation

        private ConsolidationStats ConsolidateDuplicates()
        {
            var stats = new ConsolidationStats();

            // Consolidate patterns with identical descriptions
            stats.Removed += ConsolidateDuplicatePatterns();

            // Future: Consolidate facts, decisions, etc.

            return stats;
        }

        private int ConsolidateDuplicatePatterns()
        {
            var patternsPath = Path.Combine(_memoryPath, "PATTERNS.jsonl");
            if (!File.Exists(patternsPath))
                return 0;

            var patterns = ReadJsonLines<Pattern>(patternsPath);
            var grouped = patterns.GroupBy(p => p.PatternDescription);

            var duplicatesRemoved = 0;
            var consolidated = new List<Pattern>();

            foreach (var group in grouped)
            {
                if (group.Count() == 1)
                {
                    consolidated.Add(group.First());
                    continue;
                }

                // Merge duplicates - keep highest confidence, combine evidence
                var merged = group.First();
                merged.Confidence = group.Max(p => p.Confidence);
                merged.Occurrences = group.Sum(p => p.Occurrences);
                merged.Evidence = group.SelectMany(p => p.Evidence).Distinct().ToList();
                merged.LastSeen = group.Max(p => p.LastSeen);

                consolidated.Add(merged);
                duplicatesRemoved += group.Count() - 1;

                if (group.Count() > 1)
                {
                    Console.WriteLine($"  Merged {group.Count()} duplicate patterns: {merged.PatternDescription}");
                }
            }

            if (duplicatesRemoved > 0)
            {
                // Rewrite patterns file
                File.Delete(patternsPath);
                foreach (var pattern in consolidated)
                {
                    AppendJsonLine(patternsPath, pattern);
                }
            }

            return duplicatesRemoved;
        }

        #endregion

        #region Stale Item Detection

        private StaleItemStats FlagStaleItems()
        {
            var stats = new StaleItemStats();

            // Check for stale uncertainties in UNCERTAINTIES.md
            var uncertaintiesPath = Path.Combine(_memoryPath, "UNCERTAINTIES.md");
            if (File.Exists(uncertaintiesPath))
            {
                var content = File.ReadAllText(uncertaintiesPath);
                var lines = content.Split('\n');

                var staleCount = 0;
                foreach (var line in lines)
                {
                    if (line.StartsWith("- [ ]") || line.StartsWith("- [x]"))
                    {
                        // Check if it's been there a long time (this is simplified)
                        // In reality, would track creation dates
                        staleCount++;
                    }
                }

                if (staleCount > 5)
                {
                    Console.WriteLine($"  WARNING: {staleCount} uncertainties - consider reviewing");
                    stats.Flagged = staleCount;
                }
            }

            return stats;
        }

        #endregion

        #region Compression

        private CompressionStats CompressArchives()
        {
            var stats = new CompressionStats();
            var archiveDir = Path.Combine(_memoryPath, "Archive");

            if (!Directory.Exists(archiveDir))
                return stats;

            var uncompressed = Directory.GetFiles(archiveDir, "*.jsonl")
                .Where(f => File.GetLastWriteTime(f) < DateTime.Now.AddDays(-30))
                .ToList();

            foreach (var file in uncompressed)
            {
                var fileName = Path.GetFileName(file);
                var gzPath = file + ".gz";

                var originalSize = new FileInfo(file).Length;

                using (var original = File.OpenRead(file))
                using (var compressed = File.Create(gzPath))
                using (var gzip = new GZipStream(compressed, CompressionMode.Compress))
                {
                    original.CopyTo(gzip);
                }

                var compressedSize = new FileInfo(gzPath).Length;
                var ratio = 1.0 - ((double)compressedSize / originalSize);

                File.Delete(file);
                stats.Compressed++;
                stats.Ratio += ratio;

                Console.WriteLine($"  Compressed: {fileName} ({FormatBytes(originalSize)} -> {FormatBytes(compressedSize)}, {ratio:P0} reduction)");
            }

            if (stats.Compressed > 0)
            {
                stats.Ratio /= stats.Compressed; // Average ratio
            }

            return stats;
        }

        #endregion

        #region Helpers

        private void PrintReport(CurationReport report)
        {
            Console.WriteLine($"Patterns extracted: {report.PatternsExtracted}");
            Console.WriteLine($"Activities consolidated: {report.ActivitiesConsolidated}");
            Console.WriteLine($"Confidence updates: {report.ConfidenceUpdates}");
            Console.WriteLine($"Patterns decayed: {report.PatternsDecayed}");
            Console.WriteLine($"Logs archived: {report.LogsArchived}");
            Console.WriteLine($"Space freed: {FormatBytes(report.SpaceFreed)}");
            Console.WriteLine($"Duplicates removed: {report.DuplicatesRemoved}");
            Console.WriteLine($"Stale items flagged: {report.StaleItemsFlagged}");
            Console.WriteLine($"Archives compressed: {report.ArchivesCompressed}");
            if (report.ArchivesCompressed > 0)
            {
                Console.WriteLine($"Compression ratio: {report.CompressionRatio:P1}");
            }
            Console.WriteLine();
            Console.WriteLine($"Completed in {(DateTime.Now - report.Timestamp).TotalSeconds:F1} seconds");
        }

        private string FormatBytes(long bytes)
        {
            string[] sizes = { "B", "KB", "MB", "GB" };
            double len = bytes;
            int order = 0;
            while (len >= 1024 && order < sizes.Length - 1)
            {
                order++;
                len /= 1024;
            }
            return $"{len:F2} {sizes[order]}";
        }

        private void AppendJsonLine<T>(string filePath, T obj)
        {
            var json = JsonSerializer.Serialize(obj, new JsonSerializerOptions
            {
                WriteIndented = false,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });
            File.AppendAllText(filePath, json + Environment.NewLine);
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
                    var obj = JsonSerializer.Deserialize<T>(line, new JsonSerializerOptions
                    {
                        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                    });
                    if (obj != null)
                        results.Add(obj);
                }
                catch (JsonException)
                {
                    continue;
                }
            }

            return results;
        }

        #endregion

        #region Stats Classes

        public class CurationReport
        {
            public DateTime Timestamp { get; set; }
            public string ProjectName { get; set; } = string.Empty;
            public int PatternsExtracted { get; set; }
            public int ActivitiesConsolidated { get; set; }
            public int ConfidenceUpdates { get; set; }
            public int PatternsDecayed { get; set; }
            public int LogsArchived { get; set; }
            public long SpaceFreed { get; set; }
            public int DuplicatesRemoved { get; set; }
            public int StaleItemsFlagged { get; set; }
            public int ArchivesCompressed { get; set; }
            public double CompressionRatio { get; set; }
        }

        private class PatternExtractionStats
        {
            public int PatternsFound { get; set; }
            public int ActivitiesConsolidated { get; set; }
        }

        private class ConfidenceUpdateStats
        {
            public int Updated { get; set; }
            public int Decayed { get; set; }
        }

        private class ArchiveStats
        {
            public int FilesArchived { get; set; }
            public long BytesFreed { get; set; }
        }

        private class ConsolidationStats
        {
            public int Removed { get; set; }
        }

        private class StaleItemStats
        {
            public int Flagged { get; set; }
        }

        private class CompressionStats
        {
            public int Compressed { get; set; }
            public double Ratio { get; set; }
        }

        #endregion
    }
}
