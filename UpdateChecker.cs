using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Diagnostics;

namespace ClaudeDevStudio
{
    /// <summary>
    /// Checks for updates from GitHub releases
    /// </summary>
    public class UpdateChecker
    {
        private const string GITHUB_REPO = "dectdan/Claude-Developer-Studio";

        // Read the installed version from the registry (set by installer)
        // Fall back to assembly version if not found
        private static readonly string CURRENT_VERSION = GetInstalledVersion();

        private static string GetInstalledVersion()
        {
            try
            {
                using var key = Microsoft.Win32.Registry.CurrentUser
                    .OpenSubKey(@"Software\ClaudeDevStudio", false);
                var ver = key?.GetValue("Version") as string;
                if (!string.IsNullOrWhiteSpace(ver)) return ver;
            }
            catch { }
            // Fallback: use assembly version
            return System.Reflection.Assembly
                .GetExecutingAssembly()
                .GetName()
                .Version?
                .ToString(3) ?? "1.1.0";
        }
        private static readonly HttpClient client = new HttpClient();

        /// <summary>
        /// Check GitHub for latest release
        /// </summary>
        public static async Task<UpdateInfo> CheckForUpdatesAsync()
        {
            try
            {
                client.DefaultRequestHeaders.UserAgent.ParseAdd("ClaudeDevStudio/1.0");
                client.Timeout = TimeSpan.FromSeconds(10); // Don't hang
                
                var response = await client.GetStringAsync(
                    $"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
                );

                var release = JsonDocument.Parse(response).RootElement;
                var latestVersion = release.GetProperty("tag_name").GetString()?.TrimStart('v');
                var downloadUrl = "";
                
                // Find the MSI asset
                if (release.TryGetProperty("assets", out var assets))
                {
                    foreach (var asset in assets.EnumerateArray())
                    {
                        var name = asset.GetProperty("name").GetString();
                        if (name != null && name.EndsWith(".msi", StringComparison.OrdinalIgnoreCase))
                        {
                            downloadUrl = asset.GetProperty("browser_download_url").GetString() ?? "";
                            break;
                        }
                    }
                }
                
                // Fallback to release page if no MSI found
                if (string.IsNullOrEmpty(downloadUrl))
                {
                    downloadUrl = release.GetProperty("html_url").GetString() ?? "";
                }
                
                if (latestVersion != null && IsNewerVersion(CURRENT_VERSION, latestVersion))
                {
                    return new UpdateInfo
                    {
                        UpdateAvailable = true,
                        CurrentVersion = CURRENT_VERSION,
                        LatestVersion = latestVersion,
                        DownloadUrl = downloadUrl,
                        ReleaseNotes = release.GetProperty("body").GetString()
                    };
                }

                return new UpdateInfo 
                { 
                    UpdateAvailable = false, 
                    CurrentVersion = CURRENT_VERSION,
                    LatestVersion = CURRENT_VERSION
                };
            }
            catch
            {
                // Silently fail if GitHub is unreachable - don't interrupt user
                return new UpdateInfo 
                { 
                    UpdateAvailable = false, 
                    CurrentVersion = CURRENT_VERSION 
                };
            }
        }

        /// <summary>
        /// Open download page in browser
        /// </summary>
        public static void OpenDownloadPage(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch
            {
                // Ignore if browser fails to open
            }
        }

        private static bool IsNewerVersion(string current, string latest)
        {
            var currentParts = current.Split('.');
            var latestParts = latest.Split('.');

            for (int i = 0; i < Math.Min(currentParts.Length, latestParts.Length); i++)
            {
                if (int.TryParse(currentParts[i], out int c) && int.TryParse(latestParts[i], out int l))
                {
                    if (l > c) return true;
                    if (l < c) return false;
                }
            }

            return latestParts.Length > currentParts.Length;
        }
    }

    public class UpdateInfo
    {
        public bool UpdateAvailable { get; set; }
        public string? CurrentVersion { get; set; }
        public string? LatestVersion { get; set; }
        public string? DownloadUrl { get; set; }
        public string? ReleaseNotes { get; set; }
    }
}
