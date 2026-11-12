using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using ClaudeDevStudio.Memory;

namespace ClaudeDevStudio.TrayApp
{
    // Watches the phase runs ClaudeDevStudio started (from P9) and says when one finishes, ends on a
    // question, is stopped or fails. The runs come from [Documents]\ClaudeDevStudio\phases.json, which
    // claudedev_phase_start writes (newest first); each entry points at the project's
    // docs\<phase>_run.json, whose last run the runner fills in when it ends ("outcome": finished,
    // question, error, no_result, closed; "stopped_by_request"). Read-only: it never changes a file.
    //
    // A poll every 15 seconds (cheap: one small index and a few small files). The first poll only
    // remembers what it sees, so runs that ended before the tray app started don't pop up.
    internal sealed class PhaseWatcher : IDisposable
    {
        public sealed record PhaseEvent(string Project, string Phase, string Title, string Text);

        private readonly System.Windows.Forms.Timer _timer = new() { Interval = 15000 };
        private readonly Dictionary<string, string> _seen = new(StringComparer.OrdinalIgnoreCase);
        private bool _primed;

        public event Action<PhaseEvent>? Changed;

        public static string IndexFile => Path.Combine(MemoryPaths.Root, "phases.json");

        public PhaseWatcher()
        {
            _timer.Tick += (s, e) => Poll();
        }

        public void Start()
        {
            Poll();
            _timer.Start();
        }

        public void Dispose() => _timer.Dispose();

        // Reads a file another process may be writing (the runner renames its .json into place).
        internal static JsonDocument? ReadJson(string file)
        {
            for (var i = 0; i < 3; i++)
            {
                try
                {
                    using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                    using var sr = new StreamReader(fs);
                    return JsonDocument.Parse(sr.ReadToEnd());
                }
                catch (FileNotFoundException) { return null; }
                catch (DirectoryNotFoundException) { return null; }
                catch { System.Threading.Thread.Sleep(50); }
            }
            return null;
        }

        private static string? Str(JsonElement e, string name) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static bool Has(JsonElement e, string name) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null && v.ValueKind != JsonValueKind.False;

        private void Poll()
        {
            try
            {
                using var index = ReadJson(IndexFile);
                if (index == null || !index.RootElement.TryGetProperty("runs", out var runs) || runs.ValueKind != JsonValueKind.Array) { _primed = true; return; }
                foreach (var entry in runs.EnumerateArray())
                {
                    var project = Str(entry, "project");
                    var phase = Str(entry, "phase");
                    var metaFile = Str(entry, "meta");
                    if (project == null || phase == null || metaFile == null) continue;
                    if (DateTime.TryParse(Str(entry, "started"), out var started) && (DateTime.Now - started).TotalDays > 14) continue;
                    var (key, ev) = Look(project, phase, metaFile);
                    if (key == null) continue;
                    var id = metaFile;
                    var known = _seen.TryGetValue(id, out var old);
                    _seen[id] = key;
                    if (_primed && ev != null && (!known || old != key)) Changed?.Invoke(ev);
                }
            }
            catch { /* a notification is never worth an error */ }
            _primed = true;
        }

        // (a key for the run's current state, the event to show if it is new; null while it runs)
        private static (string? key, PhaseEvent? ev) Look(string project, string phase, string metaFile)
        {
            using var meta = ReadJson(metaFile);
            if (meta == null || !meta.RootElement.TryGetProperty("runs", out var runs) || runs.ValueKind != JsonValueKind.Array || runs.GetArrayLength() == 0)
                return (null, null);
            var n = runs.GetArrayLength();
            var r = runs[n - 1];
            var name = Path.GetFileName(project.TrimEnd('\\', '/'));
            PhaseEvent E(string what, string text) => new(project, phase, $"{phase} {what}", $"{name}: {text}");

            if (Has(r, "stopped_by_request"))
                return ($"{n}:stopped", E("was stopped", "stopped by request."));
            if (Has(r, "ended"))
            {
                var outcome = Str(r, "outcome");
                var output = r.TryGetProperty("output_written", out var ow) && ow.ValueKind == JsonValueKind.True;
                var outText = output ? $"docs\\{phase}_OUTPUT.md written." : $"no docs\\{phase}_OUTPUT.md yet.";
                return outcome switch
                {
                    "question" => ($"{n}:question", E("asks a question", Short(Str(r, "question") ?? "it ends with a question; answer it from the chat."))),
                    "finished" => ($"{n}:finished", E("finished", outText)),
                    "error" => ($"{n}:error", E("failed", "it ended with an error. " + outText)),
                    "no_result" => ($"{n}:no_result", E("ended without a result", $"exit code {NumOr(r, "exit_code")}.")),
                    "closed" => ($"{n}:closed", E("window closed", "the Claude Code window was closed. " + outText)),
                    _ => Has(r, "error")
                        ? ($"{n}:failed", E("failed", Short(Str(r, "error") ?? "it didn't start.")))
                        : ($"{n}:ended", E("ended", outText)),
                };
            }
            // Not ended: running, unless its runner is gone (crashed, killed, the PC restarted).
            var pid = r.TryGetProperty("runner_pid", out var p) && p.TryGetInt32(out var pp) ? pp : 0;
            var requested = Str(r, "runner_started") ?? Str(r, "requested");
            if (pid == 0)
            {
                if (DateTime.TryParse(requested, out var req) && (DateTime.Now - req).TotalMinutes > 2)
                    return ($"{n}:gone", E("failed", "it never started."));
                return ($"{n}:running", null);
            }
            if (IsAlive(pid, requested)) return ($"{n}:running", null);
            return ($"{n}:gone", E("stopped unexpectedly", "its process is gone (crashed, killed, or the PC restarted)."));
        }

        private static string NumOr(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.ToString() : "?";

        private static string Short(string s) => s.Length > 180 ? s.Substring(0, 179) + "…" : s;

        // Alive = the process exists and started within a minute of when the run recorded it (pids are reused).
        private static bool IsAlive(int pid, string? startedIso)
        {
            try
            {
                using var proc = Process.GetProcessById(pid);
                if (proc.HasExited) return false;
                if (!DateTime.TryParse(startedIso, null, System.Globalization.DateTimeStyles.RoundtripKind, out var t)) return true;
                return Math.Abs((proc.StartTime.ToUniversalTime() - t.ToUniversalTime()).TotalSeconds) < 60;
            }
            catch (ArgumentException) { return false; }
            catch { return true; } // access denied etc.: assume it runs
        }
    }
}
