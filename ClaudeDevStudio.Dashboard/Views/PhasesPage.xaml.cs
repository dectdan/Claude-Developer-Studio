using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using ClaudeDevStudio.Memory;

namespace ClaudeDevStudio.Dashboard.Views
{
    // The Phases page (from P9): pick a project, see its phases (docs\*_run.json), and for one phase
    // Status's summary and the conversation as readable text, refreshed while it runs. The text comes
    // from the installed mcp-server\cds-phase.js (`--status`, `--conversation --json`), the same code
    // the chat tools use, so the page and claudedev_phase_status always agree. Buttons: Stop, Open in
    // Claude Code (claude --resume <session> in a window in the project), Open folder. It never
    // answers a phase's question: answers go through chat-side Claude or the user's own window.
    public sealed partial class PhasesPage : Page
    {
        public sealed record Target(string? Project, string? Phase);

        private readonly ObservableCollection<PhaseRow> _phases = new();
        private readonly ObservableCollection<ConvItem> _conv = new();
        private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(3) };
        private string? _project;
        private PhaseRow? _current;
        private string _signature = "";
        private string? _sessionId;
        private bool _running, _manual, _loading;
        private string? _wantPhase;

        public PhasesPage()
        {
            InitializeComponent();
            PhaseList.ItemsSource = _phases;
            ConvList.ItemsSource = _conv;
            _timer.Tick += async (s, e) => await RefreshIfChangedAsync();
            Unloaded += (s, e) => _timer.Stop();
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            var t = e.Parameter as Target;
            LoadProjects(t?.Project);
            _wantPhase = t?.Phase;
            if (!string.IsNullOrEmpty(t?.Project)) SelectProject(t!.Project!);
            _timer.Start();
        }

        // ------------------------------------------------------------------------------------
        // Projects: the ones in [Documents]\ClaudeDevStudio\phases.json (written when a phase is
        // started), then the folders browsed here before (HKCU\Software\ClaudeDevStudio\PhaseProjects).
        // ------------------------------------------------------------------------------------

        private void LoadProjects(string? extra)
        {
            var list = new List<string>();
            void Add(string? p) { if (!string.IsNullOrWhiteSpace(p) && !list.Any(x => string.Equals(x, p, StringComparison.OrdinalIgnoreCase))) list.Add(p!); }
            Add(extra);
            try
            {
                var index = Path.Combine(MemoryPaths.Root, "phases.json");
                if (File.Exists(index))
                {
                    using var doc = JsonDocument.Parse(ReadShared(index));
                    if (doc.RootElement.TryGetProperty("runs", out var runs) && runs.ValueKind == JsonValueKind.Array)
                        foreach (var r in runs.EnumerateArray())
                            if (r.TryGetProperty("project", out var p) && p.ValueKind == JsonValueKind.String) Add(p.GetString());
                }
            }
            catch { /* no index yet */ }
            foreach (var p in RememberedProjects()) Add(p);
            ProjectBox.ItemsSource = list.Where(Directory.Exists).ToList();
        }

        private static IEnumerable<string> RememberedProjects()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\ClaudeDevStudio", false);
                return key?.GetValue("PhaseProjects") as string[] ?? Array.Empty<string>();
            }
            catch { return Array.Empty<string>(); }
        }

        private static void Remember(string project)
        {
            try
            {
                var list = new List<string> { project };
                list.AddRange(RememberedProjects().Where(p => !string.Equals(p, project, StringComparison.OrdinalIgnoreCase)));
                using var key = Registry.CurrentUser.CreateSubKey(@"Software\ClaudeDevStudio");
                key.SetValue("PhaseProjects", list.Take(12).ToArray(), RegistryValueKind.MultiString);
            }
            catch { /* only a convenience */ }
        }

        private void SelectProject(string project)
        {
            var items = (ProjectBox.ItemsSource as List<string>) ?? new List<string>();
            var hit = items.FirstOrDefault(x => string.Equals(x, project, StringComparison.OrdinalIgnoreCase));
            if (hit == null) { items.Insert(0, project); ProjectBox.ItemsSource = null; ProjectBox.ItemsSource = items; hit = project; }
            ProjectBox.SelectedItem = hit;
        }

        private void ProjectBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (ProjectBox.SelectedItem is string p) { _project = p; LoadPhases(); }
        }

        private async void Browse_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var picker = new Windows.Storage.Pickers.FolderPicker();
                picker.FileTypeFilter.Add("*");
                var window = (Application.Current as App)?.m_window;
                if (window != null) WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(window));
                var folder = await picker.PickSingleFolderAsync();
                if (folder == null) return;
                Remember(folder.Path);
                LoadProjects(folder.Path);
                SelectProject(folder.Path);
            }
            catch (Exception ex) { StatusText.Text = $"Couldn't open the folder picker: {ex.Message}"; }
        }

        private void Refresh_Click(object sender, RoutedEventArgs e)
        {
            var keep = _current?.Phase;
            LoadPhases(keep);
        }

        // ------------------------------------------------------------------------------------
        // Phases: docs\*_run.json, newest first.
        // ------------------------------------------------------------------------------------

        private void LoadPhases(string? select = null)
        {
            _phases.Clear();
            if (_project == null) return;
            var docs = Path.Combine(_project, "docs");
            if (!Directory.Exists(docs)) { StatusText.Text = $"{_project} has no docs folder, so no phase runs."; return; }
            foreach (var f in new DirectoryInfo(docs).GetFiles("*_run.json").OrderByDescending(f => f.LastWriteTime))
            {
                var phase = f.Name.Substring(0, f.Name.Length - "_run.json".Length);
                _phases.Add(new PhaseRow(phase, f.FullName, ShortState(f.FullName, f.LastWriteTime)));
            }
            if (_phases.Count == 0) { StatusText.Text = $"No phase runs in {docs} yet (no docs\\<phase>_run.json)."; _conv.Clear(); return; }
            var want = select ?? _wantPhase;
            _wantPhase = null;
            PhaseList.SelectedItem = _phases.FirstOrDefault(p => string.Equals(p.Phase, want, StringComparison.OrdinalIgnoreCase)) ?? _phases[0];
        }

        // One line for the list, from the run's record (the full state is Status's).
        private static string ShortState(string metaFile, DateTime when)
        {
            try
            {
                using var doc = JsonDocument.Parse(ReadShared(metaFile));
                var root = doc.RootElement;
                var mode = root.TryGetProperty("mode", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
                string state = "run-phase.ps1 run";
                if (root.TryGetProperty("runs", out var runs) && runs.ValueKind == JsonValueKind.Array && runs.GetArrayLength() > 0)
                {
                    var r = runs[runs.GetArrayLength() - 1];
                    bool has(string n) => r.TryGetProperty(n, out var v) && v.ValueKind != JsonValueKind.Null && v.ValueKind != JsonValueKind.False;
                    var outcome = r.TryGetProperty("outcome", out var o) && o.ValueKind == JsonValueKind.String ? o.GetString() : null;
                    state = has("stopped_by_request") ? "stopped" : !has("ended") ? "running or open" : outcome switch
                    {
                        "question" => "asks a question",
                        "finished" => "finished",
                        "error" => "ended with an error",
                        "no_result" => "ended without a result",
                        "closed" => "window closed",
                        _ => "ended",
                    };
                }
                return $"{state}{(mode != null ? $" · {mode}" : "")} · {when:MMM d HH:mm}";
            }
            catch { return $"{when:MMM d HH:mm}"; }
        }

        private async void PhaseList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _current = PhaseList.SelectedItem as PhaseRow;
            _signature = "";
            _conv.Clear();
            await RefreshIfChangedAsync(force: true);
        }

        // ------------------------------------------------------------------------------------
        // One phase: Status and the conversation, again whenever the record or the log changes.
        // ------------------------------------------------------------------------------------

        private string? ConversationFile(JsonElement meta)
        {
            var phase = _current!.Phase;
            if (meta.TryGetProperty("mode", out var m) && m.GetString() == "manual")
            {
                var id = meta.TryGetProperty("session_id", out var s) ? s.GetString() : null;
                return id == null ? null : FindTranscript(id);
            }
            return Path.Combine(_project!, "docs", $"{phase}_run.log");
        }

        private static string? FindTranscript(string sessionId)
        {
            var dir = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
            if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude");
            var projects = Path.Combine(dir, "projects");
            if (!Directory.Exists(projects)) return null;
            foreach (var d in Directory.GetDirectories(projects))
            {
                var f = Path.Combine(d, sessionId + ".jsonl");
                if (File.Exists(f)) return f;
            }
            return null;
        }

        private static string Sig(string? f)
        {
            if (f == null) return "-";
            var i = new FileInfo(f);
            return i.Exists ? $"{i.Length}:{i.LastWriteTimeUtc.Ticks}" : "-";
        }

        private async Task RefreshIfChangedAsync(bool force = false)
        {
            if (_loading || _current == null || _project == null) return;
            JsonDocument? meta = null;
            try { meta = JsonDocument.Parse(ReadShared(_current.MetaFile)); } catch { /* being rewritten: next tick */ }
            if (meta == null) return;
            string? convFile;
            using (meta)
            {
                var root = meta.RootElement;
                _manual = root.TryGetProperty("mode", out var m) && m.GetString() == "manual";
                if (_manual && root.TryGetProperty("session_id", out var sid)) _sessionId = sid.GetString();
                convFile = ConversationFile(root);
                _running = false;
                if (root.TryGetProperty("runs", out var runs) && runs.ValueKind == JsonValueKind.Array && runs.GetArrayLength() > 0)
                {
                    var r = runs[runs.GetArrayLength() - 1];
                    bool has(string n) => r.TryGetProperty(n, out var v) && v.ValueKind != JsonValueKind.Null && v.ValueKind != JsonValueKind.False;
                    _running = !has("ended") && !has("stopped_by_request");
                }
            }
            var sig = Sig(_current.MetaFile) + "|" + Sig(convFile);
            // While it runs, Status's minutes move: refresh it every 30 s even when nothing else changed.
            if (!force && sig == _signature && !(_running && DateTime.Now.Second % 30 < 3)) return;
            _signature = sig;
            _loading = true;
            try
            {
                var phase = _current.Phase;
                var status = await RunPhaseJsAsync("--status", _project, phase);
                StatusText.Text = status.output.Trim().Length > 0 ? status.output.Trim() : status.error;
                if (convFile != null && File.Exists(convFile))
                {
                    var conv = await RunPhaseJsAsync("--conversation", convFile, "--json");
                    ShowConversation(conv.output, conv.error);
                }
                else
                {
                    _conv.Clear();
                    _conv.Add(ConvItem.From("start", _manual ? "No transcript yet: the Claude Code window hasn't sent its first message." : "No log yet.", null, false));
                }
                StopButton.IsEnabled = _running;
                OpenButton.IsEnabled = !_running && _sessionId != null;
                FolderButton.IsEnabled = true;
                LiveText.Text = _running ? (_manual ? "Open in a Claude Code window; refreshing as it changes." : "Running; refreshing as the log grows.") : "";
                var row = _phases.FirstOrDefault(p => p.MetaFile == _current.MetaFile);
                if (row != null) row.State = ShortState(row.MetaFile, File.GetLastWriteTime(row.MetaFile));
            }
            finally { _loading = false; }
        }

        private void ShowConversation(string json, string error)
        {
            _conv.Clear();
            if (string.IsNullOrWhiteSpace(json)) { _conv.Add(ConvItem.From("end", $"Couldn't read the conversation: {error}", null, true)); return; }
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (!_manual) _sessionId = root.TryGetProperty("session_id", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : _sessionId;
                foreach (var e in root.GetProperty("entries").EnumerateArray())
                {
                    var kind = e.GetProperty("kind").GetString() ?? "claude";
                    var text = e.TryGetProperty("text", out var t) ? t.GetString() ?? "" : "";
                    var detail = e.TryGetProperty("detail", out var d) ? d.GetString() : null;
                    var err = e.TryGetProperty("error", out var x) && x.ValueKind == JsonValueKind.True;
                    _conv.Add(ConvItem.From(kind, text, detail, err));
                }
            }
            catch (Exception ex) { _conv.Add(ConvItem.From("end", $"Couldn't read the conversation: {ex.Message}", null, true)); return; }
            if (_running) DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => ConvScroll.ChangeView(null, ConvScroll.ScrollableHeight, null));
        }

        // ------------------------------------------------------------------------------------
        // Buttons
        // ------------------------------------------------------------------------------------

        private async void Stop_Click(object sender, RoutedEventArgs e)
        {
            if (_current == null || _project == null) return;
            var dialog = new ContentDialog
            {
                XamlRoot = XamlRoot,
                Title = $"Stop {_current.Phase}?",
                Content = _manual
                    ? "This ends Claude Code in its window (Ctrl+C twice, then by force if needed). Anything it was doing is interrupted."
                    : "Claude Code gets Ctrl+C: it ends its turn and runs its SessionEnd hooks (by force if that doesn't work). The chat can continue the session afterwards with claudedev_phase_reply.",
                PrimaryButtonText = "Stop it",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Close,
            };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
            StopButton.IsEnabled = false;
            LiveText.Text = "Stopping...";
            var r = await RunPhaseJsAsync("--stop", _project, _current.Phase, "--force");
            StatusText.Text = (r.output + r.error).Trim();
            _signature = "";
            await Task.Delay(500);
            await RefreshIfChangedAsync(force: true);
        }

        private void Open_Click(object sender, RoutedEventArgs e)
        {
            if (_project == null || string.IsNullOrEmpty(_sessionId)) return;
            try { OpenTerminal(_project, $"claude --resume {_sessionId}"); }
            catch (Exception ex) { LiveText.Text = $"Couldn't open a window: {ex.Message}"; }
        }

        private void Folder_Click(object sender, RoutedEventArgs e)
        {
            if (_project != null) Process.Start("explorer.exe", _project);
        }

        // A window the user sees in the project: Windows Terminal if present, else a console.
        internal static void OpenTerminal(string dir, string command)
        {
            var wt = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WindowsApps", "wt.exe");
            ProcessStartInfo psi;
            if (File.Exists(wt))
            {
                psi = new ProcessStartInfo(wt) { UseShellExecute = false, WorkingDirectory = dir };
                foreach (var a in new[] { "-w", "new", "-d", dir, "cmd.exe", "/k", command }) psi.ArgumentList.Add(a);
            }
            else psi = new ProcessStartInfo("cmd.exe") { UseShellExecute = true, WorkingDirectory = dir, Arguments = "/k " + command };
            Process.Start(psi);
        }

        // ------------------------------------------------------------------------------------
        // cds-phase.js, run with Node
        // ------------------------------------------------------------------------------------

        // The installed mcp-server folder (CDS_MCP_DIR moves it, for development only).
        private static string McpDir()
        {
            var env = Environment.GetEnvironmentVariable("CDS_MCP_DIR");
            if (!string.IsNullOrEmpty(env)) return env;
            string? dir = null;
            try { using var key = Registry.CurrentUser.OpenSubKey(@"Software\ClaudeDevStudio", false); dir = key?.GetValue("InstallDir") as string; } catch { }
            if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeDevStudio");
            return Path.Combine(dir, "mcp-server");
        }

        private static string? NodeExe()
        {
            var c = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
            };
            return c.FirstOrDefault(File.Exists);
        }

        private static async Task<(string output, string error)> RunPhaseJsAsync(params string[] args)
        {
            var script = Path.Combine(McpDir(), "cds-phase.js");
            var node = NodeExe();
            if (node == null) return ("", "Node.js wasn't found (ClaudeDevStudio installs it in Program Files\\nodejs).");
            if (!File.Exists(script)) return ("", $"{script} is missing: reinstall ClaudeDevStudio.");
            return await Task.Run(() =>
            {
                try
                {
                    var psi = new ProcessStartInfo(node)
                    {
                        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                        StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
                    };
                    psi.ArgumentList.Add(script);
                    foreach (var a in args) psi.ArgumentList.Add(a);
                    using var p = Process.Start(psi)!;
                    var err = p.StandardError.ReadToEndAsync();
                    var output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(120000);
                    var e = err.Result;
                    // An installed copy older than 1.6.0 doesn't know these options: it prints nothing.
                    if (string.IsNullOrWhiteSpace(output) && string.IsNullOrWhiteSpace(e))
                        e = "The installed ClaudeDevStudio is older than 1.6.0: its cds-phase.js can't show this. Install 1.6.0 or later.";
                    return (output, e);
                }
                catch (Exception ex) { return ("", ex.Message); }
            });
        }

        // A file another process is writing (shared read).
        internal static string ReadShared(string file)
        {
            using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var sr = new StreamReader(fs, Encoding.UTF8);
            return sr.ReadToEnd();
        }
    }

    public sealed class PhaseRow : System.ComponentModel.INotifyPropertyChanged
    {
        public PhaseRow(string phase, string metaFile, string state) { Phase = phase; MetaFile = metaFile; _state = state; }
        public string Phase { get; }
        public string MetaFile { get; }
        private string _state;
        public string State
        {
            get => _state;
            set { if (_state != value) { _state = value; PropertyChanged?.Invoke(this, new System.ComponentModel.PropertyChangedEventArgs(nameof(State))); } }
        }
        public event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged;
    }

    // One line of the conversation, with how it looks (built once; the list only displays).
    public sealed class ConvItem
    {
        public string Kind { get; init; } = "claude";
        public string Label { get; init; } = "";
        public string Text { get; init; } = "";
        public string Detail { get; init; } = "";
        public Visibility PlainVisibility { get; init; } = Visibility.Visible;
        public Visibility ResultVisibility { get; init; } = Visibility.Collapsed;
        public Visibility LabelVisibility { get; init; } = Visibility.Collapsed;
        public Brush Background { get; init; } = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        public Brush BorderBrush { get; init; } = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        public Thickness BorderThickness { get; init; } = new Thickness(0);
        public Thickness Padding { get; init; } = new Thickness(8, 4, 8, 4);
        public Thickness Indent { get; init; } = new Thickness(0);
        public Brush TextBrush { get; init; } = Theme("TextFillColorPrimaryBrush");
        public Brush LabelBrush { get; init; } = Theme("TextFillColorSecondaryBrush");
        public FontFamily Font { get; init; } = new FontFamily("Segoe UI");
        public double Size { get; init; } = 14;

        private static Brush Theme(string key) =>
            Application.Current.Resources.TryGetValue(key, out var b) && b is Brush brush ? brush : new SolidColorBrush(Microsoft.UI.Colors.Gray);
        private static SolidColorBrush Rgb(byte a, byte r, byte g, byte b) => new(Windows.UI.Color.FromArgb(a, r, g, b));

        public static ConvItem From(string kind, string text, string? detail, bool error)
        {
            var mono = new FontFamily("Consolas");
            return kind switch
            {
                "claude" => new ConvItem { Kind = kind, Label = "Claude", LabelVisibility = Visibility.Visible, Text = text, Padding = new Thickness(8, 8, 8, 8) },
                "question" => new ConvItem
                {
                    Kind = kind, Label = "QUESTION (answer it from the chat, or in your own Claude Code window)", LabelVisibility = Visibility.Visible, Text = text,
                    Background = Rgb(0x33, 0xFF, 0xB9, 0x00), BorderBrush = Rgb(0xFF, 0xFF, 0xB9, 0x00), BorderThickness = new Thickness(2), Padding = new Thickness(12),
                    LabelBrush = Rgb(0xFF, 0xC0, 0x80, 0x00),
                },
                "user" => new ConvItem { Kind = kind, Label = "To Claude", LabelVisibility = Visibility.Visible, Text = text, Background = Rgb(0x22, 0x00, 0x78, 0xD4), Padding = new Thickness(8) },
                "tool" => new ConvItem { Kind = kind, Text = "› " + text, Font = mono, Size = 12, TextBrush = Theme("TextFillColorSecondaryBrush"), Indent = new Thickness(12, 0, 0, 0), Padding = new Thickness(8, 1, 8, 1) },
                "result" => new ConvItem
                {
                    Kind = kind, Text = text, Detail = detail ?? "", PlainVisibility = Visibility.Collapsed, ResultVisibility = Visibility.Visible,
                    TextBrush = error ? Rgb(0xFF, 0xD1, 0x34, 0x38) : Theme("TextFillColorSecondaryBrush"),
                },
                _ => new ConvItem
                {
                    Kind = kind, Text = text, Font = new FontFamily("Segoe UI"), Size = 12, TextBrush = error ? Rgb(0xFF, 0xD1, 0x34, 0x38) : Theme("TextFillColorTertiaryBrush"),
                    Padding = new Thickness(8, 6, 8, 6),
                },
            };
        }
    }
}
