using System;
using System.Windows.Forms;
using System.Drawing;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Net.Http;
using System.Net.Http.Headers;
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
        private static readonly HttpClient _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };

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
            _contextMenu.Items.Add("Configure AI Keys...", null, OnConfigureAiKeys);
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

        // Verification endpoints for each AI provider (GET /models validates the key at zero cost)
        private static readonly System.Collections.Generic.Dictionary<string, string> _verifyUrls = new()
        {
            ["together"]   = "https://api.together.xyz/v1/models",
            ["groq"]       = "https://api.groq.com/openai/v1/models",
            ["deepinfra"]  = "https://api.deepinfra.com/v1/openai/models",
            ["fireworks"]  = "https://api.fireworks.ai/inference/v1/models",
            ["openrouter"] = "https://openrouter.ai/api/v1/models",
        };

        private async Task<bool> VerifyApiKeyAsync(string providerId, string apiKey)
        {
            if (string.IsNullOrWhiteSpace(apiKey)) return false;
            if (!_verifyUrls.TryGetValue(providerId, out var url)) return false;
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey.Trim());
                var response = await _httpClient.SendAsync(request);
                return response.IsSuccessStatusCode;
            }
            catch { return false; }
        }

        private void OnConfigureAiKeys(object? sender, EventArgs e)
        {
            var cfgPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ClaudeDevStudio", "mcp-server", "qwen_config.json");

            // Read current keys
            var keys = new System.Collections.Generic.Dictionary<string, string>
            {
                ["together"]   = "",
                ["groq"]       = "",
                ["deepinfra"]  = "",
                ["fireworks"]  = "",
                ["openrouter"] = "",
            };
            if (File.Exists(cfgPath))
            {
                try
                {
                    var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(cfgPath));
                    if (doc.RootElement.TryGetProperty("providers", out var providers))
                    {
                        foreach (var key in keys.Keys.ToList())
                        {
                            if (providers.TryGetProperty(key, out var prov) &&
                                prov.TryGetProperty("api_key", out var apiKey))
                                keys[key] = apiKey.GetString() ?? "";
                        }
                    }
                }
                catch { }
            }

            // Build form
            var form = new Form
            {
                Text = "Configure AI Provider Keys",
                Width = 580, Height = 430,
                StartPosition = FormStartPosition.CenterScreen,
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false, MinimizeBox = false
            };

            var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16) };
            form.Controls.Add(panel);

            var providerList = new[]
            {
                ("together",   "Together AI  (Qwen3-Coder-480B — best for code)",  "together.ai"),
                ("groq",       "Groq  (fastest responses, good for iteration)",      "console.groq.com"),
                ("deepinfra",  "DeepInfra  (cheapest, bulk text)",                  "deepinfra.com"),
                ("fireworks",  "Fireworks  (broad model catalog, image gen)",       "fireworks.ai"),
                ("openrouter", "OpenRouter  (aggregator, 300+ models, fallback)",   "openrouter.ai"),
            };

            var fields = new System.Collections.Generic.Dictionary<string, TextBox>();
            var statusLabels = new System.Collections.Generic.Dictionary<string, Label>();
            int y = 10;
            foreach (var (id, label, url) in providerList)
            {
                var lbl = new Label { Text = label, Left = 0, Top = y, Width = 460, Font = new Font("Segoe UI", 8.5f) };
                var txt = new TextBox { Left = 0, Top = y + 18, Width = 460, Text = keys[id],
                    Font = new Font("Consolas", 8.5f), UseSystemPasswordChar = false };
                var status = new Label
                {
                    Text = string.IsNullOrWhiteSpace(keys[id]) ? "" : "\u25CF",
                    Left = 470, Top = y + 18, Width = 70, Height = 22,
                    Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                    ForeColor = Color.Gray,
                    TextAlign = ContentAlignment.MiddleLeft
                };
                panel.Controls.Add(lbl);
                panel.Controls.Add(txt);
                panel.Controls.Add(status);
                fields[id] = txt;
                statusLabels[id] = status;

                // Auto-verify when field loses focus
                var capturedId = id;
                txt.Leave += async (s, ev) =>
                {
                    var key = ((TextBox)s!).Text.Trim();
                    if (string.IsNullOrEmpty(key))
                    {
                        statusLabels[capturedId].Text = "";
                        statusLabels[capturedId].ForeColor = Color.Gray;
                        return;
                    }
                    statusLabels[capturedId].Text = "verifying...";
                    statusLabels[capturedId].ForeColor = Color.Orange;
                    bool valid = await VerifyApiKeyAsync(capturedId, key);
                    statusLabels[capturedId].Text = valid ? "\u2713 Valid" : "\u2717 Invalid";
                    statusLabels[capturedId].ForeColor = valid ? Color.Green : Color.Red;
                };

                // Verify existing keys on form load
                if (!string.IsNullOrWhiteSpace(keys[id]))
                {
                    var capturedId2 = id;
                    form.Shown += async (s, ev) =>
                    {
                        statusLabels[capturedId2].Text = "verifying...";
                        statusLabels[capturedId2].ForeColor = Color.Orange;
                        bool valid = await VerifyApiKeyAsync(capturedId2, keys[capturedId2]);
                        statusLabels[capturedId2].Text = valid ? "\u2713 Valid" : "\u2717 Invalid";
                        statusLabels[capturedId2].ForeColor = valid ? Color.Green : Color.Red;
                    };
                }

                y += 56;
            }

            var note = new Label
            {
                Text = "Keys are verified automatically. Leave blank to skip a provider.",
                Left = 0, Top = y + 4, Width = 530, ForeColor = Color.Gray,
                Font = new Font("Segoe UI", 8f)
            };
            panel.Controls.Add(note);

            var saveBtn = new Button { Text = "Save", Left = 370, Top = y + 26, Width = 80,
                DialogResult = DialogResult.OK };
            var cancelBtn = new Button { Text = "Cancel", Left = 460, Top = y + 26, Width = 80,
                DialogResult = DialogResult.Cancel };
            panel.Controls.Add(saveBtn);
            panel.Controls.Add(cancelBtn);
            form.AcceptButton = saveBtn;
            form.CancelButton = cancelBtn;

            if (form.ShowDialog() != DialogResult.OK) return;

            // Write updated config preserving everything except api_keys
            try
            {
                var raw = File.Exists(cfgPath) ? File.ReadAllText(cfgPath) : "{}";
                var node = System.Text.Json.Nodes.JsonNode.Parse(raw)!.AsObject();
                if (!node.ContainsKey("providers"))
                    node["providers"] = System.Text.Json.Nodes.JsonNode.Parse("{}");
                var provNode = node["providers"]!.AsObject();
                foreach (var (id, _, _) in providerList)
                {
                    if (!provNode.ContainsKey(id))
                        provNode[id] = System.Text.Json.Nodes.JsonNode.Parse("{}");
                    provNode[id]!.AsObject()["api_key"] = fields[id].Text.Trim();
                }
                var json = node.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(cfgPath, json, new System.Text.UTF8Encoding(false));
                MessageBox.Show("API keys saved successfully.", "Saved",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to save keys:\n{ex.Message}", "Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
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
