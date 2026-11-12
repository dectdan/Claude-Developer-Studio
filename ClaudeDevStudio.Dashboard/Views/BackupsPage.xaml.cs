using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using ClaudeDevStudio.Memory;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace ClaudeDevStudio.Dashboard.Views
{
    /// <summary>
    /// The store backups (P10): the sync line, the newest backup's age, the list. Reading only; "Back up
    /// now" runs the CLI (claudedev backup --all), which does every write.
    /// </summary>
    public sealed partial class BackupsPage : Page
    {
        public BackupsPage()
        {
            InitializeComponent();
            Loaded += (s, e) => Refresh();
        }

        private void Refresh()
        {
            var list = StoreBackups.List();
            var newest = list.Count > 0 ? list[0] : null;
            SyncText.Text = SyncStatus.Line(null, newest);
            NewestText.Text = newest == null
                ? $"No backup yet in {StoreBackups.Folder}."
                : $"Newest: {newest.Created:yyyy-MM-dd HH:mm} ({StoreBackups.Age(newest.Created)}), {StoreBackups.Describe(newest.Kind)}. {list.Count} backups in {StoreBackups.Folder}";
            BackupList.Children.Clear();
            foreach (var b in list)
            {
                BackupList.Children.Add(new TextBlock
                {
                    Text = $"{b.Created:yyyy-MM-dd HH:mm}   {StoreBackups.Describe(b.Kind),-18}   {b.Size / 1024.0 / 1024.0:F1} MB   {b.Name}",
                    FontFamily = new Microsoft.UI.Xaml.Media.FontFamily("Consolas")
                });
            }
        }

        private void Refresh_Click(object sender, RoutedEventArgs e) => Refresh();

        private void OpenFolder_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                Directory.CreateDirectory(StoreBackups.Folder);
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{StoreBackups.Folder}\"") { UseShellExecute = true });
            }
            catch { /* nothing to open */ }
        }

        private async void BackupNow_Click(object sender, RoutedEventArgs e)
        {
            BackupNowButton.IsEnabled = false;
            BusyText.Text = "Backing up...";
            var cli = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeDevStudio", "CLI", "claudedev.exe");
            var result = await Task.Run(() =>
            {
                try
                {
                    // The CLI writes UTF-8 to a pipe; say so (the default is the ANSI code page) (P11).
                    var psi = new ProcessStartInfo(cli)
                    {
                        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                        StandardOutputEncoding = System.Text.Encoding.UTF8, StandardErrorEncoding = System.Text.Encoding.UTF8
                    };
                    psi.ArgumentList.Add("backup");
                    psi.ArgumentList.Add("--all");
                    using var p = Process.Start(psi);
                    if (p == null) return "claudedev.exe did not start";
                    var err = p.StandardError.ReadToEndAsync();
                    var output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(10 * 60 * 1000);
                    return p.ExitCode == 0 ? "Done." : (output + err.Result).Trim();
                }
                catch (Exception ex) { return $"claudedev.exe could not run: {ex.Message}"; }
            });
            BusyText.Text = result;
            BackupNowButton.IsEnabled = true;
            Refresh();
        }
    }
}
