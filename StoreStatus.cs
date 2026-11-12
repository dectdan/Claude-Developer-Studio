using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace ClaudeDevStudio.Memory
{
    /// <summary>
    /// What the backups and the sync look like (P10, v1.7.0). Read-only: lists the store backups and
    /// asks Windows whether the memory root is inside OneDrive and whether OneDrive is running.
    /// Compiled into the CLI, the tray app and the Dashboard; only the CLI writes (StoreBackup.cs).
    /// </summary>
    public static class StoreBackups
    {
        /// <summary>[Documents]\ClaudeDevStudio\Backups\store: the whole-store backups.</summary>
        public static string Folder => Path.Combine(MemoryPaths.Root, "Backups", "store");

        public const string Prefix = "ClaudeDevStudio-store-";

        // ClaudeDevStudio-store-20261112-140000-daily.zip (the kind is in the name, so keeping the
        // newest 14 daily and 4 pre-upgrade ones never needs to open a zip).
        private static readonly Regex NameRule = new(
            @"^ClaudeDevStudio-store-(?<t>\d{8}-\d{6})-(?<k>[a-z-]+)\.zip$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static readonly string[] Kinds = { "daily", "upgrade", "manual", "pre-restore", "pre-import" };

        /// <summary>The kinds that are deleted beyond a count (the others are never deleted).</summary>
        public static int? KeepCount(string kind) => kind switch
        {
            "daily" => 14,
            "upgrade" => 4,
            _ => null
        };

        public static string Describe(string kind) => kind switch
        {
            "daily" => "daily",
            "upgrade" => "before an upgrade",
            "manual" => "made by hand",
            "pre-restore" => "before a restore",
            "pre-import" => "before an import",
            _ => kind
        };

        public static List<StoreBackupInfo> List()
        {
            var list = new List<StoreBackupInfo>();
            try
            {
                if (!Directory.Exists(Folder))
                    return list;
                foreach (var file in Directory.GetFiles(Folder, Prefix + "*.zip"))
                {
                    var m = NameRule.Match(Path.GetFileName(file));
                    if (!m.Success || !DateTime.TryParseExact(m.Groups["t"].Value, "yyyyMMdd-HHmmss",
                            CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var t))
                        continue;
                    long size = 0;
                    try { size = new FileInfo(file).Length; } catch { }
                    list.Add(new StoreBackupInfo
                    {
                        Path = file,
                        Name = Path.GetFileName(file),
                        Created = t,
                        Kind = m.Groups["k"].Value.ToLowerInvariant(),
                        Size = size
                    });
                }
            }
            catch { /* unreadable folder: no backups listed */ }
            return list.OrderByDescending(b => b.Created).ThenByDescending(b => b.Name, StringComparer.Ordinal).ToList();
        }

        public static StoreBackupInfo? Newest() => List().FirstOrDefault();

        public static string Age(DateTime when)
        {
            var span = DateTime.Now - when;
            if (span.TotalMinutes < 1) return "just now";
            if (span.TotalMinutes < 60) return $"{(int)span.TotalMinutes} min ago";
            if (span.TotalHours < 24) return $"{(int)span.TotalHours} h ago";
            var days = (int)span.TotalDays;
            return days == 1 ? "yesterday" : $"{days} days ago";
        }
    }

    public class StoreBackupInfo
    {
        public string Path { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public DateTime Created { get; set; }
        public string Kind { get; set; } = string.Empty;
        public long Size { get; set; }
    }

    /// <summary>
    /// Is the memory in OneDrive, and is OneDrive running? No OneDrive API and no sign-in: the
    /// account folders OneDrive records under HKCU\Software\Microsoft\OneDrive\Accounts\*\UserFolder,
    /// the OneDrive / OneDriveConsumer / OneDriveCommercial environment variables, and whether a
    /// OneDrive.exe runs in this Windows session. Sources in docs\P10_OUTPUT.md.
    /// CDS_ONEDRIVE_FOLDERS (folders separated by ';', or "none") and CDS_ONEDRIVE_RUNNING (1/0)
    /// replace what Windows says, for tests only.
    /// </summary>
    public static class SyncStatus
    {
        public class Result
        {
            public string Root { get; set; } = string.Empty;
            public string? OneDriveFolder { get; set; }
            public bool InOneDrive => OneDriveFolder != null;
            public bool OneDriveRunning { get; set; }
        }

        public static Result Detect()
        {
            var root = RealPath(MemoryPaths.Root);
            var result = new Result { Root = root };
            foreach (var folder in OneDriveFolders())
            {
                var f = RealPath(folder);
                if (IsInside(root, f))
                {
                    result.OneDriveFolder = f;
                    break;
                }
            }
            result.OneDriveRunning = IsOneDriveRunning();
            return result;
        }

        /// <summary>The one line the tray app, claudedev status and backup --status show.</summary>
        public static string Line(Result? r = null, StoreBackupInfo? newest = null)
        {
            r ??= Detect();
            var all = StoreBackups.List();
            newest ??= all.FirstOrDefault();
            var daily = all.Any(b => b.Kind == "daily" && (DateTime.Now - b.Created).TotalDays < 2);
            var backed = newest == null
                ? "not backed up yet (claudedev backup --all makes one; then it is daily)"
                : $"backed up{(daily ? " daily" : "")} (newest: {newest.Created:yyyy-MM-dd HH:mm}, {StoreBackups.Age(newest.Created)})";
            if (!r.InOneDrive)
                return $"Your memory isn't in a synced folder: export it now and then (claudedev export), or move Documents to OneDrive. It is {backed}.";
            if (!r.OneDriveRunning)
                return $"OneDrive isn't running: your memory isn't syncing right now (it is in {r.OneDriveFolder}). It is {backed}.";
            return $"Your memory is in OneDrive (synced) and {backed}.";
        }

        public static List<string> OneDriveFolders()
        {
            var test = Environment.GetEnvironmentVariable("CDS_ONEDRIVE_FOLDERS");
            if (test != null)
                return test.Trim().Equals("none", StringComparison.OrdinalIgnoreCase)
                    ? new List<string>()
                    : test.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

            var list = new List<string>();
            if (OperatingSystem.IsWindows())
            {
                try
                {
                    using var accounts = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\OneDrive\Accounts");
                    if (accounts != null)
                    {
                        foreach (var name in accounts.GetSubKeyNames())
                        {
                            using var k = accounts.OpenSubKey(name);
                            if (k?.GetValue("UserFolder") is string uf && !string.IsNullOrWhiteSpace(uf))
                                list.Add(uf);
                        }
                    }
                }
                catch { /* no access: the variables below */ }
            }
            foreach (var v in new[] { "OneDrive", "OneDriveConsumer", "OneDriveCommercial" })
            {
                var p = Environment.GetEnvironmentVariable(v);
                if (!string.IsNullOrWhiteSpace(p))
                    list.Add(p);
            }
            return list.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        public static bool IsOneDriveRunning()
        {
            var test = Environment.GetEnvironmentVariable("CDS_ONEDRIVE_RUNNING");
            if (test != null)
                return test.Trim() == "1";
            try
            {
                var session = Process.GetCurrentProcess().SessionId;
                var procs = Process.GetProcessesByName("OneDrive");
                var running = procs.Any(p => { try { return p.SessionId == session; } catch { return false; } });
                foreach (var p in procs) p.Dispose();
                return running;
            }
            catch
            {
                return false;
            }
        }

        // The folder's real path: a junction or symbolic link is followed (Documents moved by a link).
        public static string RealPath(string path)
        {
            try
            {
                var full = Path.GetFullPath(path).TrimEnd('\\', '/');
                var dir = new DirectoryInfo(full);
                // Walk up to the first existing folder, resolve links there, then add the rest back.
                var rest = new List<string>();
                while (dir != null && !dir.Exists)
                {
                    rest.Insert(0, dir.Name);
                    dir = dir.Parent;
                }
                if (dir == null)
                    return full;
                var resolved = dir.FullName;
                try
                {
                    var target = dir.ResolveLinkTarget(true);
                    if (target != null)
                        resolved = target.FullName;
                }
                catch { }
                return Path.Combine(new[] { resolved }.Concat(rest).ToArray()).TrimEnd('\\', '/');
            }
            catch
            {
                return path;
            }
        }

        public static bool IsInside(string path, string folder)
        {
            if (string.IsNullOrWhiteSpace(folder))
                return false;
            var p = path.TrimEnd('\\', '/') + "\\";
            var f = folder.TrimEnd('\\', '/') + "\\";
            return p.StartsWith(f, StringComparison.OrdinalIgnoreCase);
        }
    }
}
