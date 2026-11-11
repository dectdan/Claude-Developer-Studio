using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Win32;
using System;
using System.Diagnostics;
using System.IO;

namespace ClaudeDevStudio.Dashboard.Views
{
    public sealed partial class SettingsPage : Page
    {
        public SettingsPage()
        {
            this.InitializeComponent();
            LoadSettings();
        }

        // The install folder: the installer writes HKCU\Software\ClaudeDevStudio\InstallDir
        // (setup.nsi). Before v1.4.0 this page read InstallPath and TrayAppPath, which nothing writes.
        private static string InstallDir()
        {
            var dir = Registry.CurrentUser.OpenSubKey(@"Software\ClaudeDevStudio")?.GetValue("InstallDir") as string;
            if (string.IsNullOrEmpty(dir))
                dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeDevStudio");
            return dir;
        }

        private void LoadSettings()
        {
            // Load auto-start setting
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", false);
                var value = key?.GetValue("ClaudeDevStudio");
                AutoStartToggle.IsOn = value != null;
            }
            catch
            {
                AutoStartToggle.IsOn = false;
            }

            // Check DebugView status
            try
            {
                var installPath = InstallDir();
                if (!string.IsNullOrEmpty(installPath))
                {
                    var debugViewPath = Path.Combine(installPath, "DebugView", "dbgview64.exe");
                    if (File.Exists(debugViewPath))
                    {
                        DebugViewStatus.Text = "DebugView: Installed ✓";
                    }
                    else
                    {
                        DebugViewStatus.Text = "DebugView: Not found";
                        DebugViewStatus.Foreground = (Microsoft.UI.Xaml.Media.Brush)
                            Application.Current.Resources["SystemFillColorCautionBrush"];
                    }
                }
            }
            catch { }

            // Check MCP status (simplified - just check if config exists)
            try
            {
                var claudeConfigPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Claude", "claude_desktop_config.json");
                if (File.Exists(claudeConfigPath))
                {
                    MCPStatus.Text = "MCP: Configured ✓";
                }
                else
                {
                    MCPStatus.Text = "MCP: Not configured";
                    MCPStatus.Foreground = (Microsoft.UI.Xaml.Media.Brush)
                        Application.Current.Resources["SystemFillColorCautionBrush"];
                }
            }
            catch { }
        }

        private async void AutoStartToggle_Toggled(object sender, RoutedEventArgs e)
        {
            var toggle = sender as ToggleSwitch;
            if (toggle == null) return;

            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", true);

                if (toggle.IsOn)
                {
                    // Enable auto-start
                    var installDir = InstallDir();
                    if (!string.IsNullOrEmpty(installDir))
                    {
                        var exePath = Path.Combine(installDir, "TrayApp", "ClaudeDevStudio.TrayApp.exe");
                        key?.SetValue("ClaudeDevStudio", $"\"{exePath}\"");
                    }
                }
                else
                {
                    // Disable auto-start
                    key?.DeleteValue("ClaudeDevStudio", false);
                }
            }
            catch (Exception ex)
            {
                var dialog = new ContentDialog
                {
                    Title = "Error",
                    Content = $"Failed to update startup settings: {ex.Message}",
                    CloseButtonText = "OK",
                    XamlRoot = this.XamlRoot
                };
                await dialog.ShowAsync();

                // Revert toggle state
                toggle.Toggled -= AutoStartToggle_Toggled;
                toggle.IsOn = !toggle.IsOn;
                toggle.Toggled += AutoStartToggle_Toggled;
            }
        }

        private void ViewClaudeConfig_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var claudeConfigPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "Claude", "claude_desktop_config.json");

                if (File.Exists(claudeConfigPath))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = claudeConfigPath,
                        UseShellExecute = true
                    });
                }
                else
                {
                    var dialog = new ContentDialog
                    {
                        Title = "File Not Found",
                        Content = "Claude Desktop config file not found. Make sure Claude Desktop is installed.",
                        CloseButtonText = "OK",
                        XamlRoot = this.XamlRoot
                    };
                    _ = dialog.ShowAsync();
                }
            }
            catch (Exception ex)
            {
                var dialog = new ContentDialog
                {
                    Title = "Error",
                    Content = $"Could not open config file: {ex.Message}",
                    CloseButtonText = "OK",
                    XamlRoot = this.XamlRoot
                };
                _ = dialog.ShowAsync();
            }
        }
    }
}
