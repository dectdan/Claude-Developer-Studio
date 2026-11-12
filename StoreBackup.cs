using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ClaudeDevStudio.Memory;

namespace ClaudeDevStudio.Core
{
    /// <summary>
    /// The whole memory store in one zip (P10, v1.7.0): automatic daily backups, a backup before every
    /// upgrade, on demand, export (the same format), import (a merge), restore (a replace).
    /// The CLI owns the memory format and does every write; the tray app and the installer run
    /// the CLI. Rules: a restore or an import first backs up the store; an import never loses an
    /// entry or adds one twice; nothing is deleted except automatic backups beyond the kept count.
    /// </summary>
    public static class StoreBackup
    {
        public const string ManifestName = "cds-backup-manifest.json";
        public const string Format = "cds-store-backup";

        private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

        private static string Version =>
            typeof(StoreBackup).Assembly.GetName().Version?.ToString(3) ?? "unknown";

        // ------------------------------------------------------------------
        // What goes in
        // ------------------------------------------------------------------

        /// <summary>
        /// The store's files, relative to the root with '/' (the zip's names). Not Backups\ (backups
        /// of backups), not VSBridge\ (Visual Studio's live state, rewritten while it runs), not the
        /// Claude Code hook's once-per-file markers (hook_state\), not the old git sync's working
        /// copies (.cds-memory\, copies of the memory files plus git's internals), not temp/lock files.
        /// chat_mirror.jsonl is included: it is what claudedev_chat_resume reads, and small.
        /// </summary>
        public static List<string> StoreFiles(string root)
        {
            var list = new List<string>();
            if (!Directory.Exists(root))
                return list;
            foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(root, file).Replace('\\', '/');
                if (Excluded(rel))
                    continue;
                list.Add(rel);
            }
            list.Sort(StringComparer.OrdinalIgnoreCase);
            return list;
        }

        public static bool Excluded(string rel)
        {
            var parts = rel.Split('/');
            var first = parts[0];
            if (first.Equals("Backups", StringComparison.OrdinalIgnoreCase) ||
                first.Equals("VSBridge", StringComparison.OrdinalIgnoreCase))
                return true;
            if (parts.Any(p => p.Equals("hook_state", StringComparison.OrdinalIgnoreCase) ||
                               p.Equals(".cds-memory", StringComparison.OrdinalIgnoreCase)))
                return true;
            var name = parts[^1];
            return name.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase) ||
                   name.EndsWith(".lock", StringComparison.OrdinalIgnoreCase) ||
                   name.Equals(ManifestName, StringComparison.OrdinalIgnoreCase);
        }

        // ------------------------------------------------------------------
        // Creating a backup (also export)
        // ------------------------------------------------------------------

        public class CreateResult
        {
            public string Path { get; set; } = string.Empty;
            public int Files { get; set; }
            public long Bytes { get; set; }
            public long ZipBytes { get; set; }
            public double Seconds { get; set; }
            public List<string> Pruned { get; } = new();
        }

        /// <summary>
        /// Zips the whole store to <paramref name="target"/> (default: Backups\store\ClaudeDevStudio-store-
        /// &lt;stamp&gt;-&lt;kind&gt;.zip). Written as a .tmp first, then renamed, so a cut-off run leaves no
        /// half zip under the real name. Files being written by another process are read shared.
        /// </summary>
        public static CreateResult Create(string kind, string? target = null, DateTime? now = null)
        {
            var root = MemoryPaths.Root;
            var at = now ?? DateTime.Now;
            var sw = Stopwatch.StartNew();
            if (target == null)
            {
                Directory.CreateDirectory(StoreBackups.Folder);
                var stamp = at.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
                target = System.IO.Path.Combine(StoreBackups.Folder, $"{StoreBackups.Prefix}{stamp}-{kind}.zip");
                // Two backups in the same second (e.g. pre-import, then a manual one): never overwrite.
                for (var i = 1; File.Exists(target); i++)
                    target = System.IO.Path.Combine(StoreBackups.Folder, $"{StoreBackups.Prefix}{at.AddSeconds(i):yyyyMMdd-HHmmss}-{kind}.zip");
            }
            else
            {
                target = System.IO.Path.GetFullPath(target);
                var dir = System.IO.Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            }

            var temp = target + ".tmp";
            var manifestFiles = new List<object>();
            long total = 0;
            using (var fs = new FileStream(temp, FileMode.Create, FileAccess.ReadWrite, FileShare.None))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                foreach (var rel in StoreFiles(root))
                {
                    var full = System.IO.Path.Combine(root, rel.Replace('/', System.IO.Path.DirectorySeparatorChar));
                    byte[] data;
                    DateTime modified;
                    try
                    {
                        using var src = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                        using var ms = new MemoryStream();
                        src.CopyTo(ms);
                        data = ms.ToArray();
                        modified = File.GetLastWriteTimeUtc(full);
                    }
                    catch (IOException) { continue; }        // gone or locked: skipped (named nowhere; rare)
                    catch (UnauthorizedAccessException) { continue; }
                    var entry = zip.CreateEntry(rel, CompressionLevel.Optimal);
                    try { entry.LastWriteTime = modified.ToLocalTime(); } catch { /* before 1980 */ }
                    using (var es = entry.Open())
                        es.Write(data, 0, data.Length);
                    total += data.Length;
                    manifestFiles.Add(new { path = rel, size = data.Length, sha256 = Hash(data), modified = modified.ToString("o", CultureInfo.InvariantCulture) });
                }
                var manifest = new
                {
                    format = Format,
                    format_version = 1,
                    cds_version = Version,
                    created = at.ToString("o", CultureInfo.InvariantCulture),
                    machine = Environment.MachineName,
                    kind,
                    file_count = manifestFiles.Count,
                    total_bytes = total,
                    files = manifestFiles
                };
                var me = zip.CreateEntry(ManifestName, CompressionLevel.Optimal);
                using var mw = new StreamWriter(me.Open(), new UTF8Encoding(false));
                mw.Write(JsonSerializer.Serialize(manifest, Indented));
            }
            File.Move(temp, target, overwrite: true);
            sw.Stop();
            var result = new CreateResult
            {
                Path = target,
                Files = manifestFiles.Count,
                Bytes = total,
                ZipBytes = new FileInfo(target).Length,
                Seconds = sw.Elapsed.TotalSeconds
            };
            if (target.StartsWith(StoreBackups.Folder, StringComparison.OrdinalIgnoreCase))
                result.Pruned.AddRange(Prune());
            return result;
        }

        /// <summary>
        /// Keeps the newest 14 daily and the newest 4 pre-upgrade backups; deletes older ones of those
        /// two kinds only. Manual, pre-restore and pre-import backups are never deleted.
        /// </summary>
        public static List<string> Prune()
        {
            var deleted = new List<string>();
            foreach (var group in StoreBackups.List().GroupBy(b => b.Kind))
            {
                var keep = StoreBackups.KeepCount(group.Key);
                if (keep == null)
                    continue;
                foreach (var old in group.OrderByDescending(b => b.Created).Skip(keep.Value))
                {
                    try { File.Delete(old.Path); deleted.Add(old.Name); } catch { /* in use: next time */ }
                }
            }
            return deleted;
        }

        /// <summary>A daily backup is due when none was made today (local date).</summary>
        public static bool DailyDue(DateTime? now = null)
        {
            var today = (now ?? DateTime.Now).Date;
            return !StoreBackups.List().Any(b => b.Kind == "daily" && b.Created.Date == today);
        }

        private static string LockPath => System.IO.Path.Combine(StoreBackups.Folder, "backup.lock");

        /// <summary>
        /// claudedev backup --auto: the daily backup if it is due, under a lock (a load in Claude
        /// Desktop and one in Claude Code may start it together). Null when not due or already running.
        /// </summary>
        public static CreateResult? RunDailyIfDue(DateTime? now = null)
        {
            if (!HasMemory() || !DailyDue(now))
                return null;
            Directory.CreateDirectory(StoreBackups.Folder);
            FileStream? lockStream = null;
            try
            {
                try
                {
                    if (File.Exists(LockPath) && DateTime.UtcNow - File.GetLastWriteTimeUtc(LockPath) > TimeSpan.FromMinutes(10))
                        File.Delete(LockPath); // left by a run that was cut off
                    lockStream = new FileStream(LockPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose);
                }
                catch (IOException)
                {
                    return null; // another one is making it
                }
                if (!DailyDue(now))
                    return null;
                return Create("daily", null, now);
            }
            finally
            {
                lockStream?.Dispose();
            }
        }

        /// <summary>
        /// Called by load: if today's daily backup is due, start "claudedev backup --auto" on its own and
        /// return at once, so load (and the Claude Code hook) is not slowed. Started through the shell, so
        /// it inherits none of load's pipes (Node waits for those to close) and outlives load.
        /// CDS_AUTO_BACKUP=off turns it off (tests).
        /// </summary>
        public static bool StartDailyIfDue()
        {
            try
            {
                if (string.Equals(Environment.GetEnvironmentVariable("CDS_AUTO_BACKUP"), "off", StringComparison.OrdinalIgnoreCase))
                    return false;
                if (!HasMemory() || !DailyDue())
                    return false;
                if (File.Exists(LockPath) && DateTime.UtcNow - File.GetLastWriteTimeUtc(LockPath) < TimeSpan.FromMinutes(10))
                    return false;
                var exe = Environment.ProcessPath;
                if (string.IsNullOrEmpty(exe) || !File.Exists(exe))
                    return false;
                var psi = new ProcessStartInfo(exe, "backup --auto")
                {
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    WorkingDirectory = System.IO.Path.GetTempPath()
                };
                using var p = Process.Start(psi);
                return p != null;
            }
            catch
            {
                return false; // never fail a load for a backup
            }
        }

        private static bool HasMemory() =>
            Directory.Exists(System.IO.Path.Combine(MemoryPaths.Root, "Projects")) ||
            File.Exists(System.IO.Path.Combine(MemoryPaths.Root, "LESSONS.jsonl"));

        // ------------------------------------------------------------------
        // Reading a backup
        // ------------------------------------------------------------------

        public class Archive : IDisposable
        {
            public ZipArchive Zip { get; }
            public JsonElement? Manifest { get; }
            public Dictionary<string, (string sha, DateTime modified)> Files { get; } = new(StringComparer.OrdinalIgnoreCase);
            public string Machine => Str(Manifest, "machine") ?? "?";
            public string Created => Str(Manifest, "created") ?? "?";
            public string CdsVersion => Str(Manifest, "cds_version") ?? "?";
            public string Kind => Str(Manifest, "kind") ?? "?";
            private readonly FileStream _fs;
            private readonly JsonDocument? _doc;

            public Archive(string file)
            {
                _fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
                Zip = new ZipArchive(_fs, ZipArchiveMode.Read);
                var me = Zip.GetEntry(ManifestName);
                if (me == null)
                    return;
                using (var r = new StreamReader(me.Open(), Encoding.UTF8))
                    _doc = JsonDocument.Parse(r.ReadToEnd());
                Manifest = _doc.RootElement;
                if (_doc.RootElement.TryGetProperty("files", out var files) && files.ValueKind == JsonValueKind.Array)
                {
                    foreach (var f in files.EnumerateArray())
                    {
                        var p = Str(f, "path");
                        if (p == null) continue;
                        DateTime.TryParse(Str(f, "modified"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var m);
                        Files[p] = (Str(f, "sha256") ?? "", m);
                    }
                }
            }

            public bool IsStoreBackup => Manifest.HasValue && Str(Manifest, "format") == Format;

            public byte[] Read(string rel)
            {
                var e = Zip.GetEntry(rel) ?? throw new FileNotFoundException(rel);
                using var s = e.Open();
                using var ms = new MemoryStream();
                s.CopyTo(ms);
                return ms.ToArray();
            }

            /// <summary>Every file in the manifest is there and has its hash; names are safe.</summary>
            public List<string> Verify()
            {
                var problems = new List<string>();
                if (!IsStoreBackup)
                {
                    problems.Add($"not a ClaudeDevStudio store backup (no {ManifestName})");
                    return problems;
                }
                foreach (var (rel, info) in Files)
                {
                    if (!SafeName(rel)) { problems.Add($"unsafe name: {rel}"); continue; }
                    try
                    {
                        if (!string.Equals(Hash(Read(rel)), info.sha, StringComparison.OrdinalIgnoreCase))
                            problems.Add($"damaged: {rel}");
                    }
                    catch (FileNotFoundException) { problems.Add($"missing: {rel}"); }
                    catch (InvalidDataException) { problems.Add($"unreadable: {rel}"); }
                }
                return problems;
            }

            public void Dispose()
            {
                Zip.Dispose();
                _fs.Dispose();
                _doc?.Dispose();
            }
        }

        public static bool SafeName(string rel) =>
            !string.IsNullOrWhiteSpace(rel) && !rel.Contains("..") && !rel.Contains(':') &&
            !rel.StartsWith("/") && !rel.StartsWith("\\") && !Excluded(rel);

        // ------------------------------------------------------------------
        // Import: a merge
        // ------------------------------------------------------------------

        // This PC's own state: kept as it is when it exists (copied in only when it doesn't).
        private static readonly HashSet<string> StateFiles = new(StringComparer.OrdinalIgnoreCase)
        {
            "session_state.json", "file_digests.json", "cli_session_state.json", "phases.json",
            "backup_settings.json", "cloud_sync_settings.json", "chat_mirror.jsonl.bak", "LESSONS.jsonl.bak"
        };

        public class ImportSummary
        {
            public bool DryRun { get; set; }
            public string Source { get; set; } = string.Empty;
            public List<string> ProjectsAdded { get; } = new();
            public int FilesAdded { get; set; }
            public int FilesSame { get; set; }
            public int EntriesAdded { get; set; }
            public int FilesWithNewEntries { get; set; }
            public int Duplicates { get; set; }
            public int Renumbered { get; set; }
            public int LessonsNearDuplicate { get; set; }
            public int StateKept { get; set; }
            public List<string> KeptAside { get; } = new();
            public int HandoffsRecorded { get; set; }
            public string? BackupFirst { get; set; }
            public string? KeptAsideFolder { get; set; }
            public List<string> Problems { get; } = new();

            public string Render(string verb = "Import")
            {
                var sb = new StringBuilder();
                sb.AppendLine($"{verb} from {Source}{(DryRun ? " (dry run: nothing was written)" : "")}");
                sb.AppendLine($"  Projects added: {ProjectsAdded.Count}{(ProjectsAdded.Count > 0 ? " (" + string.Join(", ", ProjectsAdded.Take(20)) + (ProjectsAdded.Count > 20 ? ", ..." : "") + ")" : "")}");
                sb.AppendLine($"  Entries added: {EntriesAdded} (in {FilesWithNewEntries} files); skipped as duplicates: {Duplicates}" +
                              (LessonsNearDuplicate > 0 ? $"; lessons skipped as near-duplicates: {LessonsNearDuplicate}" : "") +
                              (Renumbered > 0 ? $"; given a new ID (theirs was taken): {Renumbered}" : ""));
                sb.AppendLine($"  Files added: {FilesAdded}; already the same: {FilesSame}; this PC's state kept: {StateKept}");
                if (KeptAside.Count > 0)
                    sb.AppendLine($"  Different in both, the newer kept and the other kept aside: {KeptAside.Count} ({string.Join(", ", KeptAside.Take(5))}{(KeptAside.Count > 5 ? ", ..." : "")}){(KeptAsideFolder != null ? " in " + KeptAsideFolder : "")}");
                if (HandoffsRecorded > 0)
                    sb.AppendLine($"  Handoffs: the newer session_handoff.md kept; {HandoffsRecorded} other one(s) added to HANDOFFS.jsonl");
                if (BackupFirst != null)
                    sb.AppendLine($"  Backed up first: {BackupFirst}");
                foreach (var p in Problems)
                    sb.AppendLine($"  ! {p}");
                return sb.ToString().TrimEnd();
            }
        }

        public static ImportSummary Import(string file, bool dryRun)
        {
            var root = MemoryPaths.Root;
            var summary = new ImportSummary { DryRun = dryRun };
            using var archive = new Archive(file);
            summary.Source = $"{System.IO.Path.GetFileName(file)} (made on {archive.Machine}, {archive.Created}, CDS {archive.CdsVersion}, {archive.Files.Count} files)";
            var problems = archive.Verify();
            if (problems.Count > 0)
                throw new InvalidDataException("The file is not a usable store backup, nothing was imported: " + string.Join("; ", problems.Take(5)));

            if (!dryRun && StoreFiles(root).Count > 0)
                summary.BackupFirst = Create("pre-import").Path;

            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            var asideRoot = System.IO.Path.Combine(root, "Backups", "import-kept", stamp);
            var existingProjects = new HashSet<string>(
                Directory.Exists(System.IO.Path.Combine(root, "Projects"))
                    ? Directory.GetDirectories(System.IO.Path.Combine(root, "Projects")).Select(d => System.IO.Path.GetFileName(d))
                    : Array.Empty<string>(), StringComparer.OrdinalIgnoreCase);
            var handoffs = new List<(string rel, byte[] data, DateTime modified)>();

            foreach (var (rel, info) in archive.Files.OrderBy(f => f.Key, StringComparer.OrdinalIgnoreCase))
            {
                var parts = rel.Split('/');
                if (parts.Length >= 2 && parts[0].Equals("Projects", StringComparison.OrdinalIgnoreCase) &&
                    !existingProjects.Contains(parts[1]) && !summary.ProjectsAdded.Contains(parts[1], StringComparer.OrdinalIgnoreCase))
                    summary.ProjectsAdded.Add(parts[1]);

                var target = System.IO.Path.Combine(root, rel.Replace('/', System.IO.Path.DirectorySeparatorChar));
                var data = archive.Read(rel);
                if (!File.Exists(target))
                {
                    if (!dryRun) WriteFile(target, data, info.modified);
                    summary.FilesAdded++;
                    continue;
                }
                var current = File.ReadAllBytes(target);
                if (current.AsSpan().SequenceEqual(data))
                {
                    summary.FilesSame++;
                    continue;
                }
                var name = parts[^1];
                if (StateFiles.Contains(name))
                {
                    summary.StateKept++;
                    continue;
                }
                if (name.Equals("session_handoff.md", StringComparison.OrdinalIgnoreCase))
                {
                    handoffs.Add((rel, data, info.modified)); // after HANDOFFS.jsonl is merged
                    continue;
                }
                if (name.EndsWith(".jsonl", StringComparison.OrdinalIgnoreCase))
                {
                    var lessons = rel.Equals("LESSONS.jsonl", StringComparison.OrdinalIgnoreCase);
                    var merge = JsonlMerge.Merge(ReadLines(current), ReadLines(data), lessons);
                    summary.Duplicates += merge.Duplicates;
                    summary.Renumbered += merge.Renumbered;
                    summary.LessonsNearDuplicate += merge.NearDuplicates;
                    if (merge.Added.Count > 0)
                    {
                        summary.EntriesAdded += merge.Added.Count;
                        summary.FilesWithNewEntries++;
                        if (!dryRun) AppendLines(target, merge.Added);
                    }
                    continue;
                }
                // Any other file different in both (FACTS.md, notes...): the newer one stays, the other is
                // kept aside under Backups\import-kept\<time>\ (nothing is lost either way).
                var currentModified = File.GetLastWriteTimeUtc(target);
                var theirsNewer = info.modified > currentModified;
                summary.KeptAside.Add(rel);
                summary.KeptAsideFolder = asideRoot;
                if (!dryRun)
                {
                    var aside = System.IO.Path.Combine(asideRoot, rel.Replace('/', System.IO.Path.DirectorySeparatorChar));
                    if (theirsNewer)
                    {
                        WriteFile(aside, current, currentModified);
                        WriteFile(target, data, info.modified);
                    }
                    else
                    {
                        WriteFile(aside, data, info.modified);
                    }
                }
            }

            foreach (var (rel, data, modified) in handoffs)
            {
                var target = System.IO.Path.Combine(root, rel.Replace('/', System.IO.Path.DirectorySeparatorChar));
                var dir = System.IO.Path.GetDirectoryName(target)!;
                var r = HandoffMerge.Merge(dir, Encoding.UTF8.GetString(data), modified, $"kept from an import of {System.IO.Path.GetFileName(file)} (made on {archive.Machine})", dryRun);
                summary.HandoffsRecorded += r;
            }
            return summary;
        }

        // ------------------------------------------------------------------
        // Restore: a replace
        // ------------------------------------------------------------------

        public class RestoreSummary
        {
            public int Written { get; set; }
            public int Same { get; set; }
            public int LeftAlone { get; set; }
            public string? BackupFirst { get; set; }
        }

        /// <summary>
        /// Puts every file of the backup back as it was in the backup (overwriting the current one), after
        /// backing up the current store. Files that aren't in the backup (newer days, newer projects) are
        /// left as they are: a restore never deletes. Import, by contrast, merges and never overwrites.
        /// </summary>
        public static RestoreSummary Restore(string file)
        {
            var root = MemoryPaths.Root;
            using var archive = new Archive(file);
            var problems = archive.Verify();
            if (problems.Count > 0)
                throw new InvalidDataException("The file is not a usable store backup, nothing was restored: " + string.Join("; ", problems.Take(5)));
            var s = new RestoreSummary();
            var before = StoreFiles(root);
            if (before.Count > 0)
                s.BackupFirst = Create("pre-restore").Path;
            foreach (var (rel, info) in archive.Files)
            {
                var target = System.IO.Path.Combine(root, rel.Replace('/', System.IO.Path.DirectorySeparatorChar));
                var data = archive.Read(rel);
                if (File.Exists(target) && File.ReadAllBytes(target).AsSpan().SequenceEqual(data))
                {
                    s.Same++;
                    continue;
                }
                WriteFile(target, data, info.modified);
                s.Written++;
            }
            s.LeftAlone = before.Count(r => !archive.Files.ContainsKey(r));
            return s;
        }

        // ------------------------------------------------------------------
        // Helpers
        // ------------------------------------------------------------------

        public static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

        internal static List<string> ReadLines(byte[] data)
        {
            var text = Encoding.UTF8.GetString(data);
            if (text.Length > 0 && text[0] == '\uFEFF') text = text[1..];
            return text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => !string.IsNullOrWhiteSpace(l)).ToList();
        }

        /// <summary>Temp file then rename, so a reader never sees half a file.</summary>
        internal static void WriteFile(string target, byte[] data, DateTime modifiedUtc)
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target)!);
            var temp = target + ".tmp";
            File.WriteAllBytes(temp, data);
            if (modifiedUtc > DateTime.MinValue)
                try { File.SetLastWriteTimeUtc(temp, modifiedUtc); } catch { }
            if (File.Exists(target))
            {
                var attrs = File.GetAttributes(target);
                if ((attrs & FileAttributes.ReadOnly) != 0)
                    File.SetAttributes(target, attrs & ~FileAttributes.ReadOnly);
            }
            File.Move(temp, target, overwrite: true);
        }

        /// <summary>Appends lines to a JSON-lines file, starting on a new line.</summary>
        internal static void AppendLines(string target, IEnumerable<string> lines)
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target)!);
            var sb = new StringBuilder();
            if (File.Exists(target) && new FileInfo(target).Length > 0)
            {
                using var fs = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                fs.Seek(-1, SeekOrigin.End);
                if (fs.ReadByte() != '\n')
                    sb.Append(Environment.NewLine);
            }
            foreach (var l in lines)
                sb.Append(l).Append(Environment.NewLine);
            File.AppendAllText(target, sb.ToString(), new UTF8Encoding(false));
        }

        internal static string? Str(JsonElement? e, string name)
        {
            if (e == null || e.Value.ValueKind != JsonValueKind.Object || !e.Value.TryGetProperty(name, out var v))
                return null;
            return v.ValueKind switch
            {
                JsonValueKind.String => v.GetString(),
                JsonValueKind.Null or JsonValueKind.Undefined => null,
                _ => v.GetRawText()
            };
        }
    }

    /// <summary>
    /// Merging two JSON-lines files with no entry lost and none added twice. Two entries are the same
    /// when the lines are identical, or when they have the same time (to the second) and the same text
    /// (the first of mistake, decision, description, pattern, lesson, where_i_stopped, operation,
    /// content, message). A new entry whose ID (ERR005, DEC002, HND010, LSN003...) is already used by a
    /// different entry gets the next free ID and keeps the old one as "original_id". Lessons: a lesson
    /// that nearly duplicates one already there (the lesson rule) is skipped.
    /// </summary>
    public static class JsonlMerge
    {
        private static readonly string[] TextFields =
            { "mistake", "decision", "description", "pattern", "lesson", "where_i_stopped", "operation", "content", "message" };
        private static readonly Regex SeqId = new(@"^(?<p>[A-Z]{3})(?<n>\d+)$", RegexOptions.CultureInvariant);

        public class Result
        {
            public List<string> Added { get; } = new();
            public int Duplicates { get; set; }
            public int Renumbered { get; set; }
            public int NearDuplicates { get; set; }
        }

        public static string Key(string line)
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                var r = doc.RootElement;
                if (r.ValueKind != JsonValueKind.Object)
                    return "raw|" + line.Trim();
                var ts = StoreBackup.Str(r, "timestamp") ?? StoreBackup.Str(r, "created") ?? "";
                if (ts.Length > 19) ts = ts[..19];
                foreach (var f in TextFields)
                {
                    var t = StoreBackup.Str(r, f);
                    if (!string.IsNullOrWhiteSpace(t))
                        return $"{ts}|{f}|{string.Join(" ", t.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))}";
                }
                return "raw|" + line.Trim();
            }
            catch (JsonException)
            {
                return "raw|" + line.Trim();
            }
        }

        public static Result Merge(List<string> current, List<string> incoming, bool lessons = false)
        {
            var result = new Result();
            var lines = new HashSet<string>(current.Select(l => l.Trim()), StringComparer.Ordinal);
            var keys = new HashSet<string>(current.Select(Key), StringComparer.Ordinal);
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var maxByPrefix = new Dictionary<string, int>(StringComparer.Ordinal);
            void NoteId(string? id)
            {
                if (string.IsNullOrEmpty(id)) return;
                ids.Add(id);
                var m = SeqId.Match(id);
                if (m.Success && int.TryParse(m.Groups["n"].Value, out var n))
                    maxByPrefix[m.Groups["p"].Value] = Math.Max(maxByPrefix.GetValueOrDefault(m.Groups["p"].Value), n);
            }
            foreach (var l in current) NoteId(IdOf(l));
            var lessonList = lessons ? current.Select(ParseLesson).Where(x => x != null).Select(x => x!).ToList() : null;

            foreach (var raw in incoming)
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                var key = Key(line);
                if (lines.Contains(line) || keys.Contains(key))
                {
                    result.Duplicates++;
                    continue;
                }
                if (lessonList != null)
                {
                    var l = ParseLesson(line);
                    if (l != null && LessonStore.FindDuplicate(l.Text, lessonList) != null)
                    {
                        result.NearDuplicates++;
                        continue;
                    }
                    if (l != null) lessonList.Add(l);
                }
                var id = IdOf(line);
                var outLine = line;
                if (!string.IsNullOrEmpty(id) && ids.Contains(id))
                {
                    var m = SeqId.Match(id);
                    if (m.Success)
                    {
                        var prefix = m.Groups["p"].Value;
                        var next = maxByPrefix.GetValueOrDefault(prefix) + 1;
                        var width = Math.Max(3, m.Groups["n"].Value.Length);
                        var newId = prefix + next.ToString(new string('0', width), CultureInfo.InvariantCulture);
                        var node = JsonNode.Parse(line)!.AsObject();
                        node["id"] = newId;
                        node["original_id"] = id;
                        outLine = node.ToJsonString();
                        result.Renumbered++;
                        id = newId;
                    }
                }
                NoteId(id);
                lines.Add(line);
                keys.Add(key);
                result.Added.Add(outLine);
            }
            return result;
        }

        private static string? IdOf(string line)
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                return StoreBackup.Str(doc.RootElement, "id");
            }
            catch (JsonException) { return null; }
        }

        private static Lesson? ParseLesson(string line)
        {
            try
            {
                var l = JsonSerializer.Deserialize<Lesson>(line);
                return l != null && !string.IsNullOrWhiteSpace(l.Text) ? l : null;
            }
            catch (JsonException) { return null; }
        }
    }

    /// <summary>
    /// Two session_handoff.md files for one project (an import, or a OneDrive conflict copy): the newer
    /// one (by its "*Written yyyy-MM-dd HH:mm" line, else the file time) is the handoff; the other is
    /// added to HANDOFFS.jsonl unless it is already there (same ID and text, or the same text).
    /// </summary>
    public static class HandoffMerge
    {
        private static readonly Regex Written = new(@"^\*(?:Written|Generated:?)\s+(?<d>\d{4}-\d\d-\d\d)[ T](?<t>\d\d:\d\d)", RegexOptions.Multiline);
        private static readonly Regex Where = new(@"^\*\*Where I stopped:\*\*\s*(?<v>.+)$", RegexOptions.Multiline);
        private static readonly Regex Next = new(@"^\*\*Next step:\*\*\s*(?<v>.+)$", RegexOptions.Multiline);

        public static DateTime WhenWritten(string md, DateTime fallbackUtc)
        {
            var m = Written.Match(md);
            if (m.Success && DateTime.TryParseExact($"{m.Groups["d"].Value} {m.Groups["t"].Value}", "yyyy-MM-dd HH:mm",
                    CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var t))
                return t.ToUniversalTime();
            return fallbackUtc;
        }

        /// <summary>Returns the number of handoffs added to HANDOFFS.jsonl (0 or 1).</summary>
        public static int Merge(string memoryDir, string otherMd, DateTime otherModifiedUtc, string origin, bool dryRun)
        {
            var mainPath = Path.Combine(memoryDir, "session_handoff.md");
            var historyPath = Path.Combine(memoryDir, "HANDOFFS.jsonl");
            var main = File.Exists(mainPath) ? File.ReadAllText(mainPath) : null;
            string loser;
            if (main == null)
            {
                if (!dryRun) StoreBackup.WriteFile(mainPath, Encoding.UTF8.GetBytes(otherMd), otherModifiedUtc);
                return 0;
            }
            var mainWhen = WhenWritten(main, File.GetLastWriteTimeUtc(mainPath));
            var otherWhen = WhenWritten(otherMd, otherModifiedUtc);
            if (otherWhen > mainWhen)
            {
                loser = main;
                if (!dryRun) StoreBackup.WriteFile(mainPath, Encoding.UTF8.GetBytes(otherMd), otherModifiedUtc);
            }
            else
            {
                loser = otherMd;
            }
            var history = File.Exists(historyPath) ? StoreBackup.ReadLines(File.ReadAllBytes(historyPath)) : new List<string>();
            if (InHistory(loser, history))
                return 0;
            if (dryRun)
                return 1;
            var next = 1;
            foreach (var l in history)
            {
                try
                {
                    using var d = JsonDocument.Parse(l);
                    var id = StoreBackup.Str(d.RootElement, "id");
                    if (id != null && id.StartsWith("HND") && int.TryParse(id[3..], out var n) && n >= next) next = n + 1;
                }
                catch (JsonException) { }
            }
            var where = Where.Match(loser);
            var nextStep = Next.Match(loser);
            var entry = new Handoff
            {
                Id = $"HND{next:D3}",
                Timestamp = (loser == main ? mainWhen : otherWhen).ToLocalTime(),
                Source = Handoff.Automatic,
                WhereIStopped = where.Success ? where.Groups["v"].Value.Trim() : Shorten(loser, 2000),
                NextStep = nextStep.Success ? nextStep.Groups["v"].Value.Trim() : "(see where_i_stopped)",
                Notes = "A session_handoff.md that was replaced by a newer one; its full text: " + Shorten(loser, 4000),
                Origin = origin
            };
            var json = JsonSerializer.Serialize(entry, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            StoreBackup.AppendLines(historyPath, new[] { json });
            return 1;
        }

        // Already in HANDOFFS.jsonl: an entry with the same "where I stopped" text (the ID alone isn't
        // enough: two PCs number their handoffs independently).
        private static bool InHistory(string md, List<string> history)
        {
            var where = Where.Match(md);
            var whereText = where.Success ? Norm(where.Groups["v"].Value) : Norm(Shorten(md, 2000));
            foreach (var l in history)
            {
                try
                {
                    using var d = JsonDocument.Parse(l);
                    var hw = StoreBackup.Str(d.RootElement, "where_i_stopped");
                    if (hw != null && Norm(hw) == whereText)
                        return true;
                }
                catch (JsonException) { }
            }
            return false;
        }

        private static string Norm(string s) => string.Join(" ", s.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        private static string Shorten(string s, int max) { var t = s.Trim(); return t.Length > max ? t[..max] + "..." : t; }
    }

    /// <summary>
    /// OneDrive conflict copies (two PCs wrote the same file within OneDrive's sync window). OneDrive
    /// keeps both: the copy gets the PC's name added to its name, e.g. MISTAKES-DESKTOP-ABC123.jsonl
    /// (Microsoft: "Report-JOHNS-SURFACE.txt"; sources in docs\P10_OUTPUT.md). CDS would read only the
    /// main file, so the copy's entries were lost to it. Here: the entries are merged into the main file
    /// (no duplicates), the copy is moved to Backups\conflicts\&lt;project&gt;\ (never deleted), and one
    /// line says what happened. Run by load and record, before they read or write.
    /// </summary>
    public static class ConflictCopies
    {
        private const string Pc = @"(?<pc>[A-Za-z0-9][A-Za-z0-9-]{0,62})";
        private static readonly Regex ProjectJsonl = new($@"^(?<base>MISTAKES|DECISIONS|PATTERNS|PERFORMANCE|HANDOFFS)-{Pc}\.jsonl$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex ActivityJsonl = new($@"^(?<base>\d{{4}}-\d\d-\d\d)-{Pc}\.jsonl$", RegexOptions.CultureInvariant);
        private static readonly Regex HandoffMd = new($@"^(?<base>session_handoff)-{Pc}\.md$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex AsideOnly = new($@"^(?<base>FACTS|UNCERTAINTIES)-{Pc}\.md$|^(?<base>session_state|file_digests)-{Pc}\.json$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex RootJsonl = new($@"^(?<base>LESSONS|chat_mirror)-{Pc}\.jsonl$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        /// <summary>Merges the conflict copies in one project's memory folder. Returns one line per copy.</summary>
        public static List<string> MergeProject(string memoryDir)
        {
            var notes = new List<string>();
            if (!Directory.Exists(memoryDir))
                return notes;
            var project = Path.GetFileName(memoryDir.TrimEnd('\\', '/'));
            var copies = new List<(string path, string main, string kind, string pc)>();
            foreach (var f in Directory.GetFiles(memoryDir))
            {
                var n = Path.GetFileName(f);
                Match m;
                if ((m = ProjectJsonl.Match(n)).Success) copies.Add((f, Path.Combine(memoryDir, m.Groups["base"].Value.ToUpperInvariant() + ".jsonl"), "jsonl", m.Groups["pc"].Value));
                else if ((m = HandoffMd.Match(n)).Success) copies.Add((f, Path.Combine(memoryDir, "session_handoff.md"), "handoff", m.Groups["pc"].Value));
                else if ((m = AsideOnly.Match(n)).Success) copies.Add((f, "", "aside", m.Groups["pc"].Value));
            }
            var act = Path.Combine(memoryDir, "Activity");
            if (Directory.Exists(act))
            {
                foreach (var f in Directory.GetFiles(act, "*.jsonl"))
                {
                    var m = ActivityJsonl.Match(Path.GetFileName(f));
                    if (m.Success) copies.Add((f, Path.Combine(act, m.Groups["base"].Value + ".jsonl"), "jsonl", m.Groups["pc"].Value));
                }
            }
            if (copies.Count == 0)
                return notes;
            return WithLock(memoryDir, () => Handle(copies, project, memoryDir));
        }

        /// <summary>Conflict copies of the store's own files (LESSONS.jsonl, chat_mirror.jsonl).</summary>
        public static List<string> MergeRoot()
        {
            var root = MemoryPaths.Root;
            var copies = new List<(string path, string main, string kind, string pc)>();
            if (!Directory.Exists(root))
                return new List<string>();
            foreach (var f in Directory.GetFiles(root, "*.jsonl"))
            {
                var m = RootJsonl.Match(Path.GetFileName(f));
                if (m.Success)
                {
                    var b = m.Groups["base"].Value.Equals("LESSONS", StringComparison.OrdinalIgnoreCase) ? "LESSONS" : "chat_mirror";
                    copies.Add((f, Path.Combine(root, b + ".jsonl"), b == "LESSONS" ? "lessons" : "jsonl", m.Groups["pc"].Value));
                }
            }
            if (copies.Count == 0)
                return new List<string>();
            return WithLock(root, () => Handle(copies, "_store", null));
        }

        private static List<string> Handle(List<(string path, string main, string kind, string pc)> copies, string project, string? memoryDir)
        {
            var notes = new List<string>();
            var dest = Path.Combine(MemoryPaths.Root, "Backups", "conflicts", project);
            foreach (var (path, main, kind, pc) in copies)
            {
                if (!File.Exists(path)) continue; // another process got it first
                var name = Path.GetFileName(path);
                try
                {
                    string what;
                    if (kind == "jsonl" || kind == "lessons")
                    {
                        var current = File.Exists(main) ? StoreBackup.ReadLines(File.ReadAllBytes(main)) : new List<string>();
                        var merge = JsonlMerge.Merge(current, StoreBackup.ReadLines(File.ReadAllBytes(path)), kind == "lessons");
                        if (merge.Added.Count > 0)
                            StoreBackup.AppendLines(main, merge.Added);
                        what = merge.Added.Count > 0
                            ? $"merged {merge.Added.Count} {(merge.Added.Count == 1 ? "entry" : "entries")} from a OneDrive conflict copy made on {pc} ({name})"
                            : $"a OneDrive conflict copy made on {pc} ({name}) held nothing new";
                    }
                    else if (kind == "handoff")
                    {
                        var added = HandoffMerge.Merge(memoryDir!, File.ReadAllText(path), File.GetLastWriteTimeUtc(path),
                            $"kept from a OneDrive conflict copy made on {pc}", dryRun: false);
                        what = $"a OneDrive conflict copy of the handoff made on {pc} ({name}): the newer one is the handoff" +
                               (added > 0 ? ", the other added to HANDOFFS.jsonl" : "");
                    }
                    else
                    {
                        what = $"a OneDrive conflict copy made on {pc} ({name}) was set aside; the main file is kept";
                    }
                    var moved = MoveAside(path, dest);
                    notes.Add($"{Capitalize(what)}; the copy is kept in {Path.GetRelativePath(MemoryPaths.Root, moved)}.");
                }
                catch (Exception ex)
                {
                    notes.Add($"A OneDrive conflict copy {name} could not be merged ({ex.Message}); it is left where it is.");
                }
            }
            return notes;
        }

        private static string MoveAside(string path, string destDir)
        {
            Directory.CreateDirectory(destDir);
            var target = Path.Combine(destDir, Path.GetFileName(path));
            if (File.Exists(target))
                target = Path.Combine(destDir, $"{Path.GetFileNameWithoutExtension(path)}.{DateTime.Now:yyyyMMdd-HHmmss}{Path.GetExtension(path)}");
            File.Move(path, target);
            return target;
        }

        // Two CLI processes (Claude Desktop and Claude Code) may load the same project at once.
        private static List<string> WithLock(string dir, Func<List<string>> work)
        {
            var lockPath = Path.Combine(dir, "conflict_merge.lock");
            FileStream? fs = null;
            try
            {
                try
                {
                    if (File.Exists(lockPath) && DateTime.UtcNow - File.GetLastWriteTimeUtc(lockPath) > TimeSpan.FromMinutes(2))
                        File.Delete(lockPath);
                    fs = new FileStream(lockPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose);
                }
                catch (IOException)
                {
                    return new List<string>(); // the other one is merging them
                }
                return work();
            }
            finally
            {
                fs?.Dispose();
            }
        }

        private static string Capitalize(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];
    }
}
