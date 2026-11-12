using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Diagnostics;

namespace ClaudeDevStudio.Dashboard.Views
{
    public sealed partial class AboutPage : Page
    {
        public AboutPage()
        {
            this.InitializeComponent();
            // The version is the assembly's (set once in Directory.Build.props), not a fixed string.
            var v = typeof(AboutPage).Assembly.GetName().Version;
            VersionText.Text = v == null ? "" : $"v{v.Major}.{v.Minor}.{v.Build}";
        }

        private async void CheckUpdates_Click(object sender, RoutedEventArgs e)
        {
            UpdateButton.IsEnabled = false;
            UpdateButton.Content = "Checking...";

            try
            {
                var updateInfo = await UpdateChecker.CheckForUpdatesAsync();

                if (updateInfo.UpdateAvailable)
                {
                    var dialog = new ContentDialog
                    {
                        Title = "Update Available",
                        Content = $"Version {updateInfo.LatestVersion} is available!\n\n" +
                                 $"Current Version: {updateInfo.CurrentVersion}\n" +
                                 $"Latest Version: {updateInfo.LatestVersion}\n\n" +
                                 (string.IsNullOrEmpty(updateInfo.ReleaseNotes) ? "" : updateInfo.ReleaseNotes + "\n\n") +
                                 "Would you like to download it now?",
                        PrimaryButtonText = "Download",
                        CloseButtonText = "Later",
                        XamlRoot = this.XamlRoot
                    };

                    var result = await dialog.ShowAsync();

                    if (result == ContentDialogResult.Primary && updateInfo.DownloadUrl != null)
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = updateInfo.DownloadUrl,
                            UseShellExecute = true
                        });
                    }
                }
                else
                {
                    var dialog = new ContentDialog
                    {
                        Title = "No Updates",
                        Content = $"You're running the latest version ({updateInfo.CurrentVersion})",
                        CloseButtonText = "OK",
                        XamlRoot = this.XamlRoot
                    };

                    await dialog.ShowAsync();
                }
            }
            catch (Exception ex)
            {
                var dialog = new ContentDialog
                {
                    Title = "Error",
                    Content = $"Failed to check for updates:\n{ex.Message}",
                    CloseButtonText = "OK",
                    XamlRoot = this.XamlRoot
                };

                await dialog.ShowAsync();
            }
            finally
            {
                UpdateButton.IsEnabled = true;
                UpdateButton.Content = "Check for Updates";
            }
        }
    }
}
