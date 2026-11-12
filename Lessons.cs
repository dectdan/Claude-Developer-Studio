using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ClaudeDevStudio.Memory
{
    // MemoryPaths (the memory root, CDS_MEMORY_ROOT for tests) is in ClaudeMemory.cs, which the
    // tray app and the Dashboard compile too; this file is the CLI's only.

    /// <summary>
    /// A lesson for every project (P5). File: LESSONS.jsonl at the memory root (one per machine).
    /// claudedev_load shows the newest in every project; check (and claudedev_check_mistake)
    /// checks a plan against them with the mistake-matching rule.
    /// </summary>
    public class Lesson
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty; // LSN001, LSN002

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("lesson")]
        public string Text { get; set; } = string.Empty;

        /// <summary>Where it was learned: the project, the date, what happened.</summary>
        [JsonPropertyName("why")]
        public string Why { get; set; } = string.Empty;

        [JsonPropertyName("source_project")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? SourceProject { get; set; }

        [JsonPropertyName("updated")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public DateTime? Updated { get; set; }
    }

    /// <summary>
    /// Reads and writes LESSONS.jsonl. The CLI owns this file like every memory file:
    /// add appends one line; edit and remove rewrite the file (temp file, then replace) after
    /// copying it to LESSONS.jsonl.bak.
    /// A new lesson is refused when it is empty, or a near-duplicate of an existing one: the
    /// mistake-matching rule (MistakeMatching: at least 3 shared words making at least 30% of the
    /// smaller word set) applied to the two lessons' texts.
    /// </summary>
    public static class LessonStore
    {
        private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };

        public static string FilePath => Path.Combine(MemoryPaths.Root, "LESSONS.jsonl");

        public static List<Lesson> ReadAll()
        {
            var list = new List<Lesson>();
            if (!File.Exists(FilePath))
                return list;
            foreach (var line in File.ReadAllLines(FilePath))
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;
                try
                {
                    var l = JsonSerializer.Deserialize<Lesson>(line.TrimStart('﻿'), Json);
                    if (l != null && !string.IsNullOrWhiteSpace(l.Text))
                        list.Add(l);
                }
                catch (JsonException)
                {
                    // Unreadable line: skip it.
                }
            }
            return list;
        }

        /// <summary>The existing lesson the text nearly duplicates (the best match), or null.</summary>
        public static Lesson? FindDuplicate(string text, IEnumerable<Lesson> lessons, string? exceptId = null) =>
            lessons
                .Where(l => exceptId == null || !string.Equals(l.Id, exceptId, StringComparison.OrdinalIgnoreCase))
                .Select(l => (l, score: MistakeMatching.Score(text, l.Text)))
                .Where(x => x.score > 0)
                .OrderByDescending(x => x.score)
                .Select(x => x.l)
                .FirstOrDefault();

        /// <summary>The lessons a planned action matches (the mistake-matching rule on the lesson's text), best first.</summary>
        public static List<(Lesson lesson, double score)> Matches(string plan) =>
            ReadAll()
                .Select(l => (l, score: MistakeMatching.Score(plan, l.Text)))
                .Where(x => x.score > 0)
                .OrderByDescending(x => x.score)
                .ThenByDescending(x => x.l.Timestamp)
                .ToList();

        /// <summary>
        /// Adds a lesson. Returns null and sets <paramref name="refusal"/> when it is refused
        /// (empty, or a near-duplicate unless <paramref name="force"/>).
        /// </summary>
        public static Lesson? Add(Lesson lesson, bool force, out string? refusal)
        {
            refusal = null;
            lesson.Text = OneLine(lesson.Text);
            lesson.Why = OneLine(lesson.Why);
            lesson.SourceProject = string.IsNullOrWhiteSpace(lesson.SourceProject) ? null : OneLine(lesson.SourceProject);
            if (string.IsNullOrWhiteSpace(lesson.Text))
            {
                refusal = "A lesson needs \"lesson\": the lesson, in one plain sentence. Nothing was recorded.";
                return null;
            }

            var existing = ReadAll();
            var dup = force ? null : FindDuplicate(lesson.Text, existing);
            if (dup != null)
            {
                var shared = string.Join(", ", MistakeMatching.Keywords(lesson.Text).Intersect(MistakeMatching.Keywords(dup.Text)));
                refusal = $"Not recorded: it nearly duplicates {dup.Id}: \"{dup.Text}\" (shared words: {shared}). " +
                          $"To change that one: claudedev lesson edit {dup.Id} <json>.";
                return null;
            }

            Directory.CreateDirectory(MemoryPaths.Root);
            lesson.Id = $"LSN{NextIdNumber(existing):D3}";
            lesson.Timestamp = DateTime.Now;
            lesson.Updated = null;
            File.AppendAllText(FilePath, JsonSerializer.Serialize(lesson, Json) + Environment.NewLine);
            return lesson;
        }

        /// <summary>Changes the given fields of a lesson (the others are kept). False when there is no such ID.</summary>
        public static bool Edit(string id, Lesson changes, bool force, out string? refusal)
        {
            refusal = null;
            var all = ReadAll();
            var target = all.FirstOrDefault(l => string.Equals(l.Id, id, StringComparison.OrdinalIgnoreCase));
            if (target == null)
                return false;
            if (!string.IsNullOrWhiteSpace(changes.Text))
            {
                var text = OneLine(changes.Text);
                var dup = force ? null : FindDuplicate(text, all, target.Id);
                if (dup != null)
                {
                    refusal = $"Not changed: the new text nearly duplicates {dup.Id}: \"{dup.Text}\".";
                    return true;
                }
                target.Text = text;
            }
            if (!string.IsNullOrWhiteSpace(changes.Why))
                target.Why = OneLine(changes.Why);
            if (changes.SourceProject != null)
                target.SourceProject = string.IsNullOrWhiteSpace(changes.SourceProject) ? null : OneLine(changes.SourceProject);
            target.Updated = DateTime.Now;
            Rewrite(all);
            return true;
        }

        /// <summary>Removes a lesson. False when there is no such ID.</summary>
        public static bool Remove(string id, out Lesson? removed)
        {
            var all = ReadAll();
            removed = all.FirstOrDefault(l => string.Equals(l.Id, id, StringComparison.OrdinalIgnoreCase));
            if (removed == null)
                return false;
            all.Remove(removed);
            Rewrite(all);
            return true;
        }

        // Back up, write a temp file, replace. Unreadable lines of the old file are kept in the backup.
        private static void Rewrite(List<Lesson> lessons)
        {
            var file = FilePath;
            if (File.Exists(file))
                File.Copy(file, file + ".bak", overwrite: true);
            var temp = file + ".tmp";
            File.WriteAllLines(temp, lessons.Select(l => JsonSerializer.Serialize(l, Json)));
            File.Move(temp, file, overwrite: true);
        }

        private static int NextIdNumber(IEnumerable<Lesson> lessons)
        {
            var max = 0;
            foreach (var l in lessons)
            {
                if (l.Id.Length > 3 && l.Id.StartsWith("LSN", StringComparison.Ordinal) &&
                    int.TryParse(l.Id.AsSpan(3), out var n) && n > max)
                    max = n;
            }
            // A removed lesson's number is not reused while the backup still holds it.
            var bak = FilePath + ".bak";
            if (File.Exists(bak))
            {
                foreach (var line in File.ReadAllLines(bak))
                {
                    try
                    {
                        var l = JsonSerializer.Deserialize<Lesson>(line, Json);
                        if (l != null && l.Id.StartsWith("LSN", StringComparison.Ordinal) &&
                            int.TryParse(l.Id.AsSpan(3), out var n) && n > max)
                            max = n;
                    }
                    catch (JsonException) { }
                }
            }
            return max + 1;
        }

        private static string OneLine(string? s) =>
            string.Join(" ", (s ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }
}
