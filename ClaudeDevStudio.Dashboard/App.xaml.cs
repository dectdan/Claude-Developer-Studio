using Microsoft.UI.Xaml;
using System;
using System.IO;

namespace ClaudeDevStudio.Dashboard
{
    public partial class App : Application
    {
        internal Window? m_window;

        public App()
        {
            this.InitializeComponent();
            
            // Global error handling
            this.UnhandledException += App_UnhandledException;
            AppDomain.CurrentDomain.UnhandledException += CurrentDomain_UnhandledException;
        }

        protected override void OnLaunched(LaunchActivatedEventArgs e)
        {
            try
            {
                var main = new MainWindow();
                m_window = main;
                m_window.Activate();
                // --phases [<project> [<phase>]] (P9: the tray app's phase notifications and menu)
                var args = Environment.GetCommandLineArgs();
                var i = Array.FindIndex(args, a => string.Equals(a, "--phases", StringComparison.OrdinalIgnoreCase));
                if (i >= 0)
                    main.NavigateToPhases(i + 1 < args.Length ? args[i + 1] : null, i + 2 < args.Length ? args[i + 2] : null);
            }
            catch (Exception ex)
            {
                LogError("Failed to launch application", ex);
                // Try to show error to user
                try
                {
                    var errorWindow = new Window
                    {
                        Title = "ClaudeDevStudio - Error"
                    };
                    errorWindow.Content = new Microsoft.UI.Xaml.Controls.TextBlock
                    {
                        Text = $"Failed to start ClaudeDevStudio:\n\n{ex.Message}\n\nCheck the log file for details.",
                        Margin = new Thickness(20),
                        TextWrapping = TextWrapping.Wrap
                    };
                    errorWindow.Activate();
                }
                catch
                {
                    // If we can't even show error window, just exit
                    Environment.Exit(1);
                }
            }
        }

        private void App_UnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
        {
            LogError("Unhandled exception", e.Exception);
            e.Handled = true; // Prevent crash, try to continue
        }

        private void CurrentDomain_UnhandledException(object sender, System.UnhandledExceptionEventArgs e)
        {
            if (e.ExceptionObject is Exception ex)
            {
                LogError("Fatal unhandled exception", ex);
            }
        }

        private void LogError(string context, Exception ex)
        {
            try
            {
                var logDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "ClaudeDevStudio",
                    "Logs");

                Directory.CreateDirectory(logDir);

                var logFile = Path.Combine(logDir, $"errors_{DateTime.Now:yyyy-MM-dd}.log");
                var logEntry = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {context}\n" +
                              $"Exception: {ex.GetType().Name}\n" +
                              $"Message: {ex.Message}\n" +
                              $"Stack: {ex.StackTrace}\n" +
                              $"---\n\n";

                File.AppendAllText(logFile, logEntry);
            }
            catch
            {
                // Can't log - nothing we can do
            }
        }
    }
}
