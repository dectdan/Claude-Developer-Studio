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
        private ToolStripMenuItem _claudeCodeItem = null!;
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
            _claudeCodeItem = new ToolStripMenuItem("Set up Claude Code...", null, OnClaudeCode);
            _contextMenu.Items.Add(_claudeCodeItem);
            _contextMenu.Opening += (s, e) => _claudeCodeItem.Text = ClaudeCodeIsSetUp() ? "Remove from Claude Code..." : "Set up Claude Code...";
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

        // Claude Code's user settings (CLAUDE_CONFIG_DIR moves it, as it does for Claude Code).
        private static string ClaudeCodeSettingsPath()
        {
            var dir = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
            if (string.IsNullOrEmpty(dir))
                dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude");
            return Path.Combine(dir, "settings.json");
        }

        // Set up = a CDS hook (a command that runs cds-hook.js) is in Claude Code's user settings.
        private static bool ClaudeCodeIsSetUp()
        {
            try
            {
                var f = ClaudeCodeSettingsPath();
                return File.Exists(f) && File.ReadAllText(f).Contains("cds-hook.js", StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        // "Set up Claude Code..." / "Remove from Claude Code...": explains, asks, then runs
        // claudedev claude-code setup | remove and shows what it did. Opt-in: never done silently.
        private void OnClaudeCode(object? sender, EventArgs e)
        {
            var setUp = ClaudeCodeIsSetUp();
            var question = setUp
                ? "Remove ClaudeDevStudio from Claude Code?\n\n" +
                  "This takes out only what \"Set up Claude Code\" added: the claudedevstudio and cds-workbench servers " +
                  "(user scope) and the four hooks that run cds-hook.js. Everything else in your Claude Code settings stays. " +
                  "Your memory in Documents\\ClaudeDevStudio is kept."
                : "Set up Claude Code to use ClaudeDevStudio?\n\n" +
                  "Claude Code sessions will then:\n" +
                  "  - get the CDS tools (the claudedevstudio and cds-workbench servers, user scope);\n" +
                  "  - load the project's memory and ground truth when a session starts;\n" +
                  "  - save an automatic handoff before compaction and when a session ends;\n" +
                  "  - note each file edited (once per file per session).\n\n" +
                  "It adds four hooks to " + ClaudeCodeSettingsPath() + " and two servers to Claude Code's ~/.claude.json, " +
                  "backs both files up first, and keeps everything else in them. Only folders that look like projects are used.\n\n" +
                  "You can undo it from this menu (Remove from Claude Code) or with: claudedev claude-code remove";
            if (MessageBox.Show(question, setUp ? "Remove from Claude Code" : "Set up Claude Code",
                    MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.OK)
                return;

            try
            {
                var claudedev = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "ClaudeDevStudio", "CLI", "claudedev.exe");
                var psi = new ProcessStartInfo(claudedev)
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                psi.ArgumentList.Add("claude-code");
                psi.ArgumentList.Add(setUp ? "remove" : "setup");
                using var p = Process.Start(psi);
                if (p == null) throw new InvalidOperationException("claudedev.exe did not start");
                var errTask = p.StandardError.ReadToEndAsync();
                var output = p.StandardOutput.ReadToEnd();
                var finished = p.WaitForExit(120000);
                var msg = (output + errTask.Result).Trim();
                var ok = finished && p.ExitCode == 0;
                MessageBox.Show(
                    msg + (ok && !setUp ? "\n\nStart a new Claude Code session to use it." : ""),
                    ok ? (setUp ? "Removed from Claude Code" : "Claude Code set up") : "Not done",
                    MessageBoxButtons.OK, ok ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Could not run claudedev claude-code:\n{ex.Message}", "Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        // The Dashboard folder: InstallDir (written by the installer) + Dashboard. (Before v1.4.0
        // this read a DashboardPath value that nothing writes.)
        private static string DashboardDir()
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\ClaudeDevStudio", false);
            var dir = key?.GetValue("InstallDir") as string;
            if (string.IsNullOrEmpty(dir))
                dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeDevStudio");
            return Path.Combine(dir, "Dashboard");
        }

        private void OnOpenDashboard(object? sender, EventArgs e)
        {
            try
            {
                var dashboardPath = DashboardDir();

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
                var dashboardPath = DashboardDir();

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
            // The product version (Directory.Build.props); About no longer asks GitHub for it.
            var version = typeof(TrayApplication).Assembly.GetName().Version?.ToString(3) ?? "unknown";

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
                "GitHub: github.com/dectdan/Claude-Developer-Studio",
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
