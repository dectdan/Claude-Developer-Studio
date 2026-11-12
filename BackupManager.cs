using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;

namespace ClaudeDevStudio.Core
{
    /// <summary>
    /// Manages backups of ClaudeDevStudio memory and state
    /// Supports OneDrive, Git, and Cloud sync strategies
    /// </summary>
    public class BackupManager
    {
        private readonly string _projectPath;
        private readonly string _projectName;
        private readonly BackupSettings _settings;

        public BackupManager(string projectPath)
        {
            _projectPath = projectPath;
            _projectName = Path.GetFileName(projectPath);
            _settings = LoadSettings();
        }

        /// <summary>
        /// Create a backup with automatic trigger detection
        /// </summary>
        public BackupResult CreateBackup(BackupTrigger trigger = BackupTrigger.Manual)
        {
            try
            {
                // Check if backup is needed
                if (!ShouldBackup(trigger))
                {
                    return new BackupResult
                    {
                        Success = true,
                        Message = "Backup not needed at this time",
                        Skipped = true
                    };
                }

                var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
                var backupName = $"{_projectName}_{timestamp}.backup";

                // Determine backup location based on strategy
                var backupPath = GetBackupPath(_settings.Strategy);
                Directory.CreateDirectory(backupPath);

                var backupFile = Path.Combine(backupPath, backupName);

                // Create backup archive
                CreateBackupArchive(backupFile);

                // Update settings
                _settings.LastBackup = DateTime.UtcNow;
                _settings.BackupCount++;
                _settings.TotalBackupSize += new FileInfo(backupFile).Length;
                SaveSettings(_settings);

                // From 1.7.0 (P10) per-project backups are only made by hand (or before a restore), and
                // backups made by hand are never deleted: no clean-up here any more.

                return new BackupResult
                {
                    Success = true,
                    BackupPath = backupFile,
                    Size = new FileInfo(backupFile).Length,
                    Message = $"Backup created: {backupName}",
                    Trigger = trigger
                };
            }
            catch (Exception ex)
            {
                return new BackupResult
                {
                    Success = false,
                    Message = $"Backup failed: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Restore from a backup file
        /// </summary>
        public RestoreResult RestoreBackup(string backupFile, bool createBackupFirst = true)
        {
            try
            {
                if (!File.Exists(backupFile))
                {
                    return new RestoreResult
                    {
                        Success = false,
                        Message = $"Backup file not found: {backupFile}"
                    };
                }

                // Create safety backup before restore
                if (createBackupFirst)
                {
                    var safetyBackup = CreateBackup(BackupTrigger.PreRestore);
                }

                // Extract backup
                var tempRestore = Path.Combine(Path.GetTempPath(), $"cds_restore_{Guid.NewGuid()}");
                Directory.CreateDirectory(tempRestore);

                ZipFile.ExtractToDirectory(backupFile, tempRestore);

                // Copy files to project path
                var filesRestored = 0;
                foreach (var file in Directory.GetFiles(tempRestore, "*", SearchOption.AllDirectories))
                {
                    var relativePath = Path.GetRelativePath(tempRestore, file);
                    var targetPath = Path.Combine(_projectPath, relativePath);

                    Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
                    File.Copy(file, targetPath, overwrite: true);
                    filesRestored++;
                }

                // Cleanup temp directory
                Directory.Delete(tempRestore, recursive: true);

                return new RestoreResult
                {
                    Success = true,
                    FilesRestored = filesRestored,
                    Message = $"Restored {filesRestored} files from backup"
                };
            }
            catch (Exception ex)
            {
                return new RestoreResult
                {
                    Success = false,
                    Message = $"Restore failed: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// List available backups
        /// </summary>
        public BackupInfo[] ListBackups()
        {
            try
            {
                var backupPath = GetBackupPath(_settings.Strategy);
                if (!Directory.Exists(backupPath))
                    return Array.Empty<BackupInfo>();

                return Directory.GetFiles(backupPath, "*.backup")
                    .Select(f => new FileInfo(f))
                    .OrderByDescending(f => f.LastWriteTimeUtc)
                    .Select(f => new BackupInfo
                    {
                        FileName = f.Name,
                        FilePath = f.FullName,
                        Size = f.Length,
                        Created = f.CreationTimeUtc,
                        Age = DateTime.UtcNow - f.CreationTimeUtc
                    })
                    .ToArray();
            }
            catch
            {
                return Array.Empty<BackupInfo>();
            }
        }

        /// <summary>
        /// Check if backup should be created based on trigger and settings
        /// </summary>
        private bool ShouldBackup(BackupTrigger trigger)
        {
            // Manual backups always proceed
            if (trigger == BackupTrigger.Manual || trigger == BackupTrigger.PreRestore)
                return true;

            // Check time-based triggers
            if (trigger == BackupTrigger.Daily)
            {
                return _settings.LastBackup == null ||
                       (DateTime.UtcNow - _settings.LastBackup.Value).TotalDays >= 1;
            }

            if (trigger == BackupTrigger.Weekly)
            {
                return _settings.LastBackup == null ||
                       (DateTime.UtcNow - _settings.LastBackup.Value).TotalDays >= 7;
            }

            // Check activity-based trigger
            if (trigger == BackupTrigger.ActivityThreshold)
            {
                return GetActivityCountSinceBackup() >= _settings.ActivityThreshold;
            }

            return true;
        }

        /// <summary>
        /// Create compressed backup archive
        /// </summary>
        private void CreateBackupArchive(string backupFile)
        {
            // Create temporary directory for staging
            var tempBackup = Path.Combine(Path.GetTempPath(), $"cds_backup_{Guid.NewGuid()}");
            Directory.CreateDirectory(tempBackup);

            try
            {
                // Copy critical files
                var filesToBackup = new[]
                {
                    "session_state.json",
                    "FACTS.md",
                    "PATTERNS.jsonl",
                    "MISTAKES.jsonl",
                    "DECISIONS.jsonl",
                    "UNCERTAINTIES.md",
                    "PERFORMANCE.jsonl",
                    "HANDOFFS.jsonl",      // P10: the handoffs (from P3) were missing
                    "session_handoff.md"
                };

                foreach (var file in filesToBackup)
                {
                    var sourcePath = Path.Combine(_projectPath, file);
                    if (File.Exists(sourcePath))
                    {
                        var targetPath = Path.Combine(tempBackup, file);
                        File.Copy(sourcePath, targetPath);
                    }
                }

                // Backup Activity directory
                var activitySource = Path.Combine(_projectPath, "Activity");
                if (Directory.Exists(activitySource))
                {
                    var activityTarget = Path.Combine(tempBackup, "Activity");
                    CopyDirectory(activitySource, activityTarget);
                }

                // Add metadata
                var metadata = new BackupMetadata
                {
                    ProjectName = _projectName,
                    Created = DateTime.UtcNow,
                    Version = "1.0",
                    Machine = Environment.MachineName,
                    User = Environment.UserName
                };

                File.WriteAllText(
                    Path.Combine(tempBackup, "backup_metadata.json"),
                    JsonSerializer.Serialize(metadata, new JsonSerializerOptions { WriteIndented = true })
                );

                // Create zip archive
                ZipFile.CreateFromDirectory(tempBackup, backupFile, CompressionLevel.Optimal, false);
            }
            finally
            {
                // Cleanup temp directory
                if (Directory.Exists(tempBackup))
                    Directory.Delete(tempBackup, recursive: true);
            }
        }

        /// <summary>
        /// Get backup path based on strategy
        /// </summary>
        private string GetBackupPath(BackupStrategy strategy)
        {
            // [memory root]\Backups\<project> (MemoryPaths.Root, so CDS_MEMORY_ROOT in tests; P10).
            // The whole-store backups are in Backups\store (StoreBackup.cs).
            return strategy switch
            {
                BackupStrategy.OneDrive => Path.Combine(
                    ClaudeDevStudio.Memory.MemoryPaths.Root,
                    "Backups",
                    _projectName),

                BackupStrategy.Git => Path.Combine(_projectPath, ".cds-backups"),

                BackupStrategy.Local => Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "ClaudeDevStudio",
                    "Backups",
                    _projectName),

                _ => Path.Combine(
                    ClaudeDevStudio.Memory.MemoryPaths.Root,
                    "Backups",
                    _projectName)
            };
        }

        /// <summary>
        /// Cleanup old backups based on retention policy
        /// </summary>
        private void CleanupOldBackups(string backupPath)
        {
            try
            {
                var backups = Directory.GetFiles(backupPath, "*.backup")
                    .Select(f => new FileInfo(f))
                    .OrderByDescending(f => f.CreationTimeUtc)
                    .ToList();

                // Keep last N backups
                var toDelete = backups.Skip(_settings.MaxBackups).ToList();

                foreach (var backup in toDelete)
                {
                    backup.Delete();
                }
            }
            catch
            {
                // Don't fail backup if cleanup fails
            }
        }

        /// <summary>
        /// Get activity count since last backup
        /// </summary>
        private int GetActivityCountSinceBackup()
        {
            try
            {
                var activityDir = Path.Combine(_projectPath, "Activity");
                if (!Directory.Exists(activityDir))
                    return 0;

                var cutoff = _settings.LastBackup ?? DateTime.MinValue;
                var count = 0;

                foreach (var file in Directory.GetFiles(activityDir, "*.jsonl"))
                {
                    foreach (var line in File.ReadLines(file))
                    {
                        try
                        {
                            using var doc = JsonDocument.Parse(line);
                            var timestamp = doc.RootElement.GetProperty("timestamp").GetDateTime();
                            if (timestamp > cutoff)
                                count++;
                        }
                        catch { }
                    }
                }

                return count;
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>
        /// Copy directory recursively
        /// </summary>
        private void CopyDirectory(string source, string target)
        {
            Directory.CreateDirectory(target);

            foreach (var file in Directory.GetFiles(source))
            {
                var fileName = Path.GetFileName(file);
                File.Copy(file, Path.Combine(target, fileName));
            }

            foreach (var dir in Directory.GetDirectories(source))
            {
                var dirName = Path.GetFileName(dir);
                CopyDirectory(dir, Path.Combine(target, dirName));
            }
        }

        /// <summary>
        /// Load backup settings
        /// </summary>
        private BackupSettings LoadSettings()
        {
            try
            {
                var settingsPath = Path.Combine(_projectPath, "backup_settings.json");
                if (!File.Exists(settingsPath))
                    return new BackupSettings();

                var json = File.ReadAllText(settingsPath);
                return JsonSerializer.Deserialize<BackupSettings>(json) ?? new BackupSettings();
            }
            catch
            {
                return new BackupSettings();
            }
        }

        /// <summary>
        /// Save backup settings
        /// </summary>
        private void SaveSettings(BackupSettings settings)
        {
            try
            {
                var settingsPath = Path.Combine(_projectPath, "backup_settings.json");
                var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(settingsPath, json);
            }
            catch
            {
                // Don't fail backup if settings save fails
            }
        }
    }

    public class BackupSettings
    {
        public BackupStrategy Strategy { get; set; } = BackupStrategy.OneDrive;
        public int MaxBackups { get; set; } = 10;
        public int ActivityThreshold { get; set; } = 50;
        public DateTime? LastBackup { get; set; }
        public int BackupCount { get; set; }
        public long TotalBackupSize { get; set; }
    }

    public enum BackupStrategy
    {
        OneDrive,   // Backup to Documents (OneDrive synced)
        Git,        // Backup via Git commits
        Local,      // Local AppData backup
        Cloud       // Cloudflare/cloud sync
    }

    public enum BackupTrigger
    {
        Manual,
        Daily,
        Weekly,
        ActivityThreshold,
        PreRestore,
        PreHandoff
    }

    public class BackupResult
    {
        public bool Success { get; set; }
        public bool Skipped { get; set; }
        public string? BackupPath { get; set; }
        public long Size { get; set; }
        public string? Message { get; set; }
        public BackupTrigger Trigger { get; set; }
    }

    public class RestoreResult
    {
        public bool Success { get; set; }
        public int FilesRestored { get; set; }
        public string? Message { get; set; }
    }

    public class BackupInfo
    {
        public string FileName { get; set; } = string.Empty;
        public string FilePath { get; set; } = string.Empty;
        public long Size { get; set; }
        public DateTime Created { get; set; }
        public TimeSpan Age { get; set; }
    }

    public class BackupMetadata
    {
        public string ProjectName { get; set; } = string.Empty;
        public DateTime Created { get; set; }
        public string Version { get; set; } = string.Empty;
        public string Machine { get; set; } = string.Empty;
        public string User { get; set; } = string.Empty;
    }
}
