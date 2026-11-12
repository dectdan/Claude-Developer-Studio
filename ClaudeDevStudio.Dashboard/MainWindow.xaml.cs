using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using ClaudeDevStudio.Dashboard.Views;

namespace ClaudeDevStudio.Dashboard
{
    public sealed partial class MainWindow : Window
    {
        public MainWindow()
        {
            this.InitializeComponent();
            
            // Set window size
            var hWnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hWnd);
            var appWindow = Microsoft.UI.Windowing.AppWindow.GetFromWindowId(windowId);
            appWindow.Resize(new Windows.Graphics.SizeInt32 { Width = 1200, Height = 800 });
            
            // Navigate to projects page by default
            ContentFrame.Navigate(typeof(ProjectsPage));
            NavView.SelectedItem = NavView.MenuItems[0];
        }

        // The Phases page (P9), on a project and phase when given (the tray's notification, or
        // ClaudeDevStudio.Dashboard.exe --phases [<project> [<phase>]]).
        public void NavigateToPhases(string? project, string? phase)
        {
            _navigatingByCode = true;
            foreach (var item in NavView.MenuItems)
            {
                if (item is NavigationViewItem navItem && navItem.Tag?.ToString() == "phases")
                {
                    NavView.SelectedItem = navItem;
                    break;
                }
            }
            _navigatingByCode = false;
            ContentFrame.Navigate(typeof(PhasesPage), new PhasesPage.Target(project, phase));
        }

        private bool _navigatingByCode;

        private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
        {
            if (_navigatingByCode) return;
            if (args.IsSettingsSelected)
            {
                ContentFrame.Navigate(typeof(SettingsPage));
            }
            else if (args.SelectedItem is NavigationViewItem item)
            {
                var tag = item.Tag?.ToString();
                switch (tag)
                {
                    case "projects":
                        ContentFrame.Navigate(typeof(ProjectsPage));
                        break;
                    case "phases":
                        ContentFrame.Navigate(typeof(PhasesPage), new PhasesPage.Target(null, null));
                        break;
                    case "activity":
                        ContentFrame.Navigate(typeof(ActivityPage));
                        break;
                    case "approvals":
                        ContentFrame.Navigate(typeof(ApprovalsPage));
                        break;
                    case "memory":
                        ContentFrame.Navigate(typeof(MemoryPage));
                        break;
                    case "patterns":
                        ContentFrame.Navigate(typeof(PatternsPage));
                        break;
                    case "mistakes":
                        ContentFrame.Navigate(typeof(MistakesPage));
                        break;
                    case "backups":
                        ContentFrame.Navigate(typeof(BackupsPage));
                        break;
                    case "help":
                        ContentFrame.Navigate(typeof(HelpPage));
                        break;
                    case "about":
                        ContentFrame.Navigate(typeof(AboutPage));
                        break;
                }
            }
        }

        public void UpdateApprovalCount(int count)
        {
            ApprovalsBadge.Value = count;
        }

        public void UpdateProjectCount(int count)
        {
            ProjectsBadge.Value = count;
        }

        public void NavigateToMemory(string projectPath)
        {
            // Navigate to Memory tab
            ContentFrame.Navigate(typeof(MemoryPage), projectPath);
            
            // Select Memory nav item
            foreach (var item in NavView.MenuItems)
            {
                if (item is NavigationViewItem navItem && navItem.Tag?.ToString() == "memory")
                {
                    NavView.SelectedItem = navItem;
                    break;
                }
            }
        }
    }
}
