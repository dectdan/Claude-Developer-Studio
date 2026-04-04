using System;
using System.Windows.Forms;
using System.Drawing;
using System.Diagnostics;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace ClaudeDevStudio.TrayApp
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Create and run the tray application
            using (var trayApp = new TrayApplication())
            {
                Application.Run();
            }
        }
    }

    public class TrayApplication : IDisposable
    {
        private NotifyIcon? _trayIcon;
        private ContextMenuStrip? _contextMenu;
        private Process? _mcpServerProcess;
        private UpdateInfo? _availableUpdate;

        public TrayApplication()
        {
            InitializeTrayIcon();
            StartMCPServer();
            CheckFirstRun();
            
            // Check for updates asynchronously (don't block startup)
            Task.Run(async () => await CheckForUpdatesAsync());
        }

        private void InitializeTrayIcon()
        {
            _contextMenu = new ContextMenuStrip();
            _contextMenu.Items.Add("Open Dashboard", null, OnOpenDashboard);
            _contextMenu.Items.Add("View Activity", null, OnViewActivity);
            _contextMenu.Items.Add(new ToolStripSeparator());
            _contextMenu.Items.Add("Link Claude Desktop...", null, OnLinkClaudeDesktop);
            _contextMenu.Items.Add(new ToolStripSeparator());
            _contextMenu.Items.Add("Pending Approvals (0)", null, OnPendingApprovals);
            _contextMenu.Items.Add(new ToolStripSeparator());
            _contextMenu.Items.Add("Check for Updates...", null, OnCheckUpdates);
            _contextMenu.Items.Add("Settings", null, OnSettings);
            _contextMenu.Items.Add("About", null, OnAbout);
            _contextMenu.Items.Add(new ToolStripSeparator());
            _contextMenu.Items.Add("Exit", null, OnExit);

            // Load embedded icon
            Icon? appIcon = null;
            try
            {
                var assembly = System.Reflection.Assembly.GetExecutingAssembly();
                var resourceName = "ClaudeDevStudio.TrayApp.icon.ico";
                using (var stream = assembly.GetManifestResourceStream(resourceName))
                {
                    if (stream != null)
                    {
                        appIcon = new Icon(stream);
                    }
                }
            }
            catch
            {
                // Fallback to system icon if loading fails
                appIcon = SystemIcons.Application;
            }

            _trayIcon = new NotifyIcon
            {
                Text = "ClaudeDevStudio",
                Icon = appIcon ?? SystemIcons.Application,
                ContextMenuStrip = _contextMenu,
                Visible = true
            };

            _trayIcon.DoubleClick += OnOpenDashboard;
            _trayIcon.BalloonTipClicked += OnUpdateBalloonClicked;
        }

        private async Task CheckForUpdatesAsync()
        {
            try
            {
                var updateInfo = await UpdateChecker.CheckForUpdatesAsync();
                
                if (updateInfo.UpdateAvailable)
                {
                    _availableUpdate = updateInfo;
                    
                    // Show balloon notification
                    if (_trayIcon != null)
                    {
                        _trayIcon.BalloonTipTitle = "Update Available";
                        _trayIcon.BalloonTipText = $"ClaudeDevStudio {updateInfo.LatestVersion} is available! Click to download.";
                        _trayIcon.BalloonTipIcon = ToolTipIcon.Info;
                        _trayIcon.ShowBalloonTip(10000); // Show for 10 seconds
                    }
                }
            }
            catch
            {
                // Silently fail - don't interrupt user experience
            }
        }

        private void OnCheckUpdates(object? sender, EventArgs e)
        {
            // Manual update check
            Task.Run(async () =>
            {
                try
                {
                    var updateInfo = await UpdateChecker.CheckForUpdatesAsync();
                    
                    if (updateInfo.UpdateAvailable)
                    {
                        _availableUpdate = updateInfo;
                        
                        var result = MessageBox.Show(
                            $"Update Available!\n\n" +
                            $"Current Version: {updateInfo.CurrentVersion}\n" +
                            $"Latest Version: {updateInfo.LatestVersion}\n\n" +
                            $"Would you like to download the update?",
                            "Update Available",
                            MessageBoxButtons.YesNo,
                            MessageBoxIcon.Information);
                        
                        if (result == DialogResult.Yes && updateInfo.DownloadUrl != null)
                        {
                            UpdateChecker.OpenDownloadPage(updateInfo.DownloadUrl);
                        }
                    }
                    else
                    {
                        MessageBox.Show(
                            $"You're running the latest version ({updateInfo.CurrentVersion})!",
                            "No Updates Available",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        $"Failed to check for updates:\n{ex.Message}",
                        "Update Check Failed",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                }
            });
        }

        private void OnUpdateBalloonClicked(object? sender, EventArgs e)
        {
            if (_availableUpdate?.DownloadUrl != null)
            {
                UpdateChecker.OpenDownloadPage(_availableUpdate.DownloadUrl);
            }
        }

        private void StartMCPServer()
        {
            // MCP server is now started by Claude Desktop via config
            // No need to start it here
        }

        private void CheckFirstRun()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\ClaudeDevStudio", false);
                if (key == null || key.GetValue("FirstRunComplete") == null)
                {
                    // Show welcome balloon
                    _trayIcon?.ShowBalloonTip(
                        5000,
                        "ClaudeDevStudio Installed!",
                        "Restart Claude Desktop to enable integration.",
                        ToolTipIcon.Info);

                    // Mark as complete
                    using var writeKey = Registry.CurrentUser.CreateSubKey(@"Software\ClaudeDevStudio");
                    writeKey.SetValue("FirstRunComplete", 1);
                }
            }
            catch
            {
                // Ignore registry errors
            }
        }

        private void OnLinkClaudeDesktop(object? sender, EventArgs e)
        {
            try
            {
                var claudedev = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "ClaudeDevStudio", "CLI", "claudedev.exe");

                var result = System.Diagnostics.Process.Start(new ProcessStartInfo
                {
                    FileName = claudedev,
                    Arguments = "configure-claude",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                });

                result?.WaitForExit(10000);
                var output = result?.StandardOutput.ReadToEnd() ?? "";
                var error  = result?.StandardError.ReadToEnd() ?? "";
                var msg    = (output + error).Trim();
                var success = result?.ExitCode == 0;

                MessageBox.Show(
                    msg + (success ? "\n\nRestart Claude Desktop to activate." : ""),
                    success ? "Linked Successfully" : "Link Failed",
                    MessageBoxButtons.OK,
                    success ? MessageBoxIcon.Information : MessageBoxIcon.Error);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Failed to link Claude Desktop:\n{ex.Message}",
                    "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OnOpenDashboard(object? sender, EventArgs e)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\ClaudeDevStudio", false);
                var dashboardPath = key?.GetValue("DashboardPath") as string;

                if (!string.IsNullOrEmpty(dashboardPath))
                {
                    var exePath = Path.Combine(dashboardPath, "ClaudeDevStudio.Dashboard.exe");
                    if (File.Exists(exePath))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exePath,
                            UseShellExecute = true
                        });
                        return;
                    }
                }

                MessageBox.Show(
                    "Dashboard not found. Please reinstall ClaudeDevStudio.",
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Failed to launch Dashboard: {ex.Message}",
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private void OnViewActivity(object? sender, EventArgs e)
        {
            var activityPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "ClaudeDevStudio",
                "Projects");

            if (Directory.Exists(activityPath))
            {
                Process.Start("explorer.exe", activityPath);
            }
        }

        private void OnPendingApprovals(object? sender, EventArgs e)
        {
            MessageBox.Show(
                "No pending approvals",
                "Approvals",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void OnSettings(object? sender, EventArgs e)
        {
            // Launch Dashboard and navigate to Settings
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\ClaudeDevStudio", false);
                var dashboardPath = key?.GetValue("DashboardPath") as string;

                if (!string.IsNullOrEmpty(dashboardPath))
                {
                    var exePath = Path.Combine(dashboardPath, "ClaudeDevStudio.Dashboard.exe");
                    if (File.Exists(exePath))
                    {
                        // Launch Dashboard - it will open to Settings page
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exePath,
                            Arguments = "/settings",  // Future: could add command line arg to open specific page
                            UseShellExecute = true
                        });
                        return;
                    }
                }

                MessageBox.Show(
                    "Dashboard not found. Please reinstall ClaudeDevStudio.",
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Failed to launch Settings: {ex.Message}\n\nPlease open Dashboard and navigate to Settings manually.",
                    "Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private void OnAbout(object? sender, EventArgs e)
        {
            var version = UpdateChecker.CheckForUpdatesAsync().Result?.CurrentVersion ?? "1.0.0";
            
            MessageBox.Show(
                $"ClaudeDevStudio v{version}\n\n" +
                "Memory & Development System for Claude AI\n\n" +
                "Copyright © 2026 Daniel E Gain\n" +
                "Email: danielegain@gmail.com\n" +
                "Licensed under MIT License\n\n" +
                "Developed with assistance from Claude (Anthropic)\n\n" +
                "Features:\n" +
                "• Debug output monitoring (DebugView integration)\n" +
                "• Project memory & context preservation\n" +
                "• Auto-backup to Documents folder\n" +
                "• Claude Desktop integration via MCP\n\n" +
                "GitHub: github.com/dectdan/Cloud-Developer-Studio",
                "About ClaudeDevStudio",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void OnExit(object? sender, EventArgs e)
        {
            Application.Exit();
        }

        public void Dispose()
        {
            if (_mcpServerProcess != null && !_mcpServerProcess.HasExited)
            {
                _mcpServerProcess.Kill();
                _mcpServerProcess.Dispose();
            }

            _trayIcon?.Dispose();
            _contextMenu?.Dispose();
        }
    }
}
