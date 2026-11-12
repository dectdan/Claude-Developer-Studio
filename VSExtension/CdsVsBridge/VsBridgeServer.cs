using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;

namespace CdsVsBridge
{
    /// <summary>
    /// HTTP server running inside the VS process on localhost:62000.
    /// Gives Claude two-way access to VS: read debugger state, evaluate
    /// expressions, trigger builds, step the debugger.
    /// All VS API calls are marshaled to the UI thread.
    /// </summary>
    internal sealed class VsBridgeServer : IDisposable
    {
        public const int Port = 62000;
        private const string Prefix = "http://localhost:62000/";

        private readonly DTE2 _dte;
        private readonly AsyncPackage _package;
        private HttpListener? _listener;
        private System.Threading.Thread? _thread;
        private volatile bool _running;

        private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
        {
            WriteIndented = true,
            DefaultIgnoreCondition =
                System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        };

        public VsBridgeServer(DTE2 dte, AsyncPackage package)
        {
            _dte = dte;
            _package = package;
        }

        // ── Lifecycle ─────────────────────────────────────────────────────────

        public void Start()
        {
            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add(Prefix);
                _listener.Start();
                _running = true;
                _thread = new System.Threading.Thread(ListenLoop) { IsBackground = true, Name = "CdsVsBridgeHttp" };
                _thread.Start();
            }
            catch { /* port in use or unavailable — silently skip */ }
        }

        public void Stop()
        {
            _running = false;
            try { _listener?.Stop(); } catch { }
        }

        public void Dispose() => Stop();

        // ── Request loop ──────────────────────────────────────────────────────

        private void ListenLoop()
        {
            while (_running)
            {
                try
                {
                    var ctx = _listener!.GetContext();
                    // Handle each request on a thread-pool thread
                    Task.Run(() => HandleRequest(ctx));
                }
                catch (HttpListenerException) { break; }
                catch { /* ignore transient errors */ }
            }
        }

        private async Task HandleRequest(HttpListenerContext ctx)
        {
            var req  = ctx.Request;
            var resp = ctx.Response;
            resp.ContentType = "application/json; charset=utf-8";
            // No Access-Control-Allow-Origin header: web pages must not read these answers.

            try
            {
                string body;
                var path = req.Url?.AbsolutePath.TrimEnd('/') ?? "";

                if (!IsAllowedCaller(req, out var refusal))
                {
                    resp.StatusCode = 403;
                    body = $@"{{""error"":""{refusal}""}}";
                }
                else if (req.HttpMethod == "GET" && path == "/state")
                    body = await GetStateJsonAsync();
                else if (req.HttpMethod == "GET" && path == "/errors")
                    body = GetErrorsJson();
                else if (req.HttpMethod == "GET" && path == "/output")
                    body = GetOutputJson(req);
                else if (req.HttpMethod == "GET" && path == "/panes")
                    body = await GetPanesJsonAsync();
                else if (req.HttpMethod == "GET" && path == "/pane")
                    body = await GetPaneJsonAsync(req);
                else if (req.HttpMethod == "GET" && path == "/debugger")
                    body = await GetDebuggerJsonAsync();
                else if (req.HttpMethod == "POST" && path == "/command")
                    body = await HandleCommandAsync(req);
                else
                {
                    resp.StatusCode = 404;
                    body = @"{""error"":""Not found""}";
                }

                var bytes = Encoding.UTF8.GetBytes(body);
                resp.ContentLength64 = bytes.Length;
                await resp.OutputStream.WriteAsync(bytes, 0, bytes.Length);
            }
            catch (Exception ex)
            {
                var err = Encoding.UTF8.GetBytes($@"{{""error"":""{ex.Message}""}}");
                try { resp.StatusCode = 500; await resp.OutputStream.WriteAsync(err, 0, err.Length); } catch { }
            }
            finally
            {
                try { resp.OutputStream.Close(); } catch { }
            }
        }

        // ── GET /state ────────────────────────────────────────────────────────

        private async Task<string> GetStateJsonAsync()
        {
            return await _package.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                var snap = new VsStateSnapshot
                {
                    Solution = _dte.Solution?.FileName,
                    DebugMode = GetDebugModeString()
                };
                try
                {
                    var doc = _dte.ActiveDocument;
                    if (doc != null)
                    {
                        snap.ActiveFile = doc.FullName;
                        if (doc.Selection is TextSelection sel)
                            snap.ActiveLine = sel.CurrentLine;
                    }
                }
                catch { }
                return JsonSerializer.Serialize(snap, JsonOpts);
            });
        }

        // ── GET /errors ───────────────────────────────────────────────────────

        private string GetErrorsJson()
        {
            var path = Path.Combine(VsStateWriter.BridgeDir, "vs_errors.json");
            return File.Exists(path) ? File.ReadAllText(path) : @"{""error"":""No build yet""}";
        }

        // ── GET /output ───────────────────────────────────────────────────────

        private string GetOutputJson(HttpListenerRequest req)
        {
            var path = Path.Combine(VsStateWriter.BridgeDir, "vs_build_output.txt");
            if (!File.Exists(path)) return @"{""output"":""""}";
            var linesParam = req.QueryString["lines"];
            var limit = int.TryParse(linesParam, out var n) ? n : 200;
            var lines = File.ReadAllLines(path);
            var skip  = lines.Length > limit ? lines.Length - limit : 0;
            var tail  = string.Join("\n", lines, skip, lines.Length - skip);
            return JsonSerializer.Serialize(new { output = tail }, JsonOpts);
        }

        // ── GET /panes, GET /pane?name=<name>&lines=<n> (from 1.5.0) ─────────
        //
        // Any Output window pane, read live (the Build pane above is the copy saved when a
        // build ends). Panes are found by the well-known GUIDs first (names are localized:
        // "build", "debug", "general"), then by name (any case), then by GUID. Only the newest
        // `lines` lines are read (default 100), straight from the pane's text buffer.

        private const int DefaultPaneLines = 100;

        private static readonly (string Key, Guid Guid)[] WellKnownPanes =
        {
            ("build",   VSConstants.OutputWindowPaneGuid.BuildOutputPane_guid),
            ("debug",   VSConstants.OutputWindowPaneGuid.DebugPane_guid),
            ("general", VSConstants.OutputWindowPaneGuid.GeneralPane_guid),
        };

        private async Task<string> GetPanesJsonAsync()
        {
            return await _package.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                return JsonSerializer.Serialize(new { panes = ListPanes() }, JsonOpts);
            });
        }

        private async Task<string> GetPaneJsonAsync(HttpListenerRequest req)
        {
            var name  = (req.QueryString["name"] ?? "build").Trim();
            var limit = int.TryParse(req.QueryString["lines"], out var n) && n > 0 ? n : DefaultPaneLines;

            return await _package.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                var pane = FindPane(name);
                if (pane == null)
                {
                    var key = name.ToLowerInvariant();
                    var why = key == "debug"
                        ? "There is no Debug pane yet: Visual Studio creates it the first time a program runs under the debugger."
                        : $"There is no Output pane named \"{name}\".";
                    return JsonSerializer.Serialize(new { error = why, panes = ListPanes() }, JsonOpts);
                }

                var info = Describe(pane);
                try
                {
                    var doc  = pane.TextDocument;
                    var end  = doc.EndPoint;
                    // A pane that ends with a line break has an empty last line: don't count it.
                    var last = end.Line > 1 && end.LineCharOffset == 1 ? end.Line - 1 : end.Line;
                    var from = Math.Max(1, last - limit + 1);
                    var ep   = doc.StartPoint.CreateEditPoint();
                    ep.MoveToLineAndOffset(from, 1);
                    var text = ep.GetText(end);
                    return JsonSerializer.Serialize(new
                    {
                        pane  = info.Name,
                        guid  = info.Guid,
                        kind  = info.Kind,
                        lines = last,
                        shown = last - from + 1,
                        text
                    }, JsonOpts);
                }
                catch (System.Runtime.InteropServices.COMException ex) when (ex.HResult == VSConstants.E_FAIL)
                {
                    // Seen in the experimental instance (P6): a pane Visual Studio has created but never
                    // written to has no text buffer yet, and TextDocument fails with E_FAIL.
                    return JsonSerializer.Serialize(new
                    {
                        pane  = info.Name,
                        guid  = info.Guid,
                        kind  = info.Kind,
                        lines = 0,
                        shown = 0,
                        text  = "",
                        note  = "Visual Studio has not written anything to this pane yet."
                    }, JsonOpts);
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new { error = $"The \"{info.Name}\" pane's text can't be read: {ex.Message}", pane = info.Name }, JsonOpts);
                }
            });
        }

        private List<PaneInfo> ListPanes()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var list = new List<PaneInfo>();
            var panes = _dte.ToolWindows?.OutputWindow?.OutputWindowPanes;
            if (panes == null) return list;
            foreach (OutputWindowPane pane in panes)
            {
                var info = Describe(pane);
                try { info.Lines = pane.TextDocument.EndPoint.Line; } catch { }
                list.Add(info);
            }
            return list;
        }

        private OutputWindowPane? FindPane(string name)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var panes = _dte.ToolWindows?.OutputWindow?.OutputWindowPanes;
            if (panes == null) return null;
            var all = new List<OutputWindowPane>();
            foreach (OutputWindowPane pane in panes) all.Add(pane);

            foreach (var known in WellKnownPanes)
            {
                if (!string.Equals(known.Key, name, StringComparison.OrdinalIgnoreCase)) continue;
                foreach (var pane in all)
                    if (SameGuid(pane, known.Guid)) return pane;
            }
            foreach (var pane in all)
                if (string.Equals(pane.Name, name, StringComparison.OrdinalIgnoreCase)) return pane;
            if (Guid.TryParse(name, out var asGuid))
                foreach (var pane in all)
                    if (SameGuid(pane, asGuid)) return pane;
            return null;
        }

        private static PaneInfo Describe(OutputWindowPane pane)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var info = new PaneInfo { Name = pane.Name };
            try { info.Guid = pane.Guid; } catch { }
            foreach (var known in WellKnownPanes)
                if (SameGuid(pane, known.Guid)) info.Kind = known.Key;
            return info;
        }

        private static bool SameGuid(OutputWindowPane pane, Guid guid)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try { return Guid.TryParse(pane.Guid, out var g) && g == guid; }
            catch { return false; }
        }

        // ── GET /debugger ─────────────────────────────────────────────────────

        private async Task<string> GetDebuggerJsonAsync()
        {
            return await _package.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                var dbg = _dte.Debugger as Debugger2;
                var mode = GetDebugModeString();

                var result = new DebuggerSnapshot { Mode = mode };

                if (mode != "break") return JsonSerializer.Serialize(result, JsonOpts);

                try
                {
                    // Call stack — try StackFrame2 for file/line via dynamic to avoid
                    // hard EnvDTE90 type dependency that caused build issues previously
                    var frames = new List<StackFrameInfo>();
                    if (dbg?.CurrentThread?.StackFrames != null)
                    {
                        int i = 0;
                        foreach (EnvDTE.StackFrame frame in dbg.CurrentThread.StackFrames)
                        {
                            var info = new StackFrameInfo
                            {
                                Frame    = i++,
                                Function = frame.FunctionName,
                                Module   = frame.Module
                            };
                            try
                            {
                                dynamic sf2 = frame;
                                string  fn  = sf2.FileName;
                                uint    ln  = sf2.LineNumber;
                                if (!string.IsNullOrEmpty(fn)) { info.File = fn; info.Line = (int)ln; }
                            }
                            catch { /* StackFrame2 unavailable — continue without file/line */ }
                            frames.Add(info);
                            if (i >= 20) break;
                        }
                    }
                    result.CallStack = frames.ToArray();

                    // Populate current location from top of call stack, fall back to active doc
                    if (frames.Count > 0 && frames[0].File != null)
                    {
                        result.CurrentFile = frames[0].File;
                        result.CurrentLine = frames[0].Line ?? 0;
                    }
                    else
                    {
                        try
                        {
                            var doc = _dte.ActiveDocument;
                            if (doc != null)
                            {
                                result.CurrentFile = doc.FullName;
                                if (doc.Selection is TextSelection sel2)
                                    result.CurrentLine = sel2.CurrentLine;
                            }
                        }
                        catch { }
                    }

                    // Locals
                    var locals = new List<LocalVar>();
                    if (dbg?.CurrentStackFrame?.Locals != null)
                    {
                        foreach (Expression local in dbg.CurrentStackFrame.Locals)
                        {
                            locals.Add(new LocalVar
                            {
                                Name  = local.Name,
                                Type  = local.Type,
                                Value = local.Value
                            });
                        }
                    }
                    result.Locals = locals.ToArray();

                    // Thread name
                    result.CurrentThread = dbg?.CurrentThread?.Name;
                }
                catch { }

                return JsonSerializer.Serialize(result, JsonOpts);
            });
        }

        // ── POST /command ─────────────────────────────────────────────────────

        private async Task<string> HandleCommandAsync(HttpListenerRequest req)
        {
            string bodyJson;
            using (var sr = new StreamReader(req.InputStream, Encoding.UTF8))
                bodyJson = await sr.ReadToEndAsync();

            var cmd = JsonSerializer.Deserialize<CommandRequest>(bodyJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (cmd == null) return @"{""error"":""Invalid JSON""}";

            return await _package.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                try
                {
                    var dbg = _dte.Debugger;
                    switch (cmd.Action)
                    {
                        case "debugger.break":    dbg.Break(false);    break;
                        case "debugger.go":       dbg.Go(false);       break;
                        case "debugger.stepinto": dbg.StepInto(false); break;
                        case "debugger.stepover": dbg.StepOver(false); break;
                        case "debugger.stepout":  dbg.StepOut(false);  break;
                        case "debugger.stop":     dbg.Stop(false);     break;
                        case "build.solution":
                            _dte.Solution.SolutionBuild.Build(true);   break;
                        case "build.clean":
                            _dte.Solution.SolutionBuild.Clean(true);   break;
                        case "evaluate":
                            if (cmd.Expression == null)
                                return @"{""error"":""Missing expression""}";
                            var expr = dbg.GetExpression(cmd.Expression, true, 500);
                            return JsonSerializer.Serialize(new
                            {
                                expression = cmd.Expression,
                                value      = expr.Value,
                                type       = expr.Type,
                                isValid    = expr.IsValidValue
                            }, JsonOpts);
                        case "navigate":
                            if (cmd.File != null)
                                _dte.ItemOperations.OpenFile(cmd.File);
                            if (cmd.Line.HasValue)
                            {
                                var sel = _dte.ActiveDocument?.Selection as TextSelection;
                                sel?.GotoLine(cmd.Line.Value, true);
                            }
                            break;
                        default:
                            return $@"{{""error"":""Unknown action: {cmd.Action}""}}";
                    }
                    return @"{""ok"":true}";
                }
                catch (Exception ex)
                {
                    return $@"{{""error"":""{ex.Message}""}}";
                }
            });
        }

        // ── Caller check ──────────────────────────────────────────────────────

        // Only local programs (the cds-workbench MCP server uses Node's http, which sends
        // no Origin header) may use the bridge. A web page open in a browser always sends
        // an Origin header, so it is refused; a Host other than this port on localhost
        // means DNS rebinding (a web site's name pointed at 127.0.0.1), so it is refused too.
        private static readonly string[] AllowedHosts = { $"localhost:{Port}", $"127.0.0.1:{Port}" };

        private static bool IsAllowedCaller(HttpListenerRequest req, out string refusal)
        {
            if (req.Headers["Origin"] != null)
            {
                refusal = "Forbidden: requests from web pages are not accepted";
                return false;
            }

            var host = req.Headers["Host"] ?? "";
            if (Array.IndexOf(AllowedHosts, host.Trim().ToLowerInvariant()) < 0)
            {
                refusal = "Forbidden: unexpected Host header";
                return false;
            }

            refusal = "";
            return true;
        }

        // ── Helpers ───────────────────────────────────────────────────────────

        private string GetDebugModeString()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            return _dte.Debugger.CurrentMode switch
            {
                dbgDebugMode.dbgBreakMode  => "break",
                dbgDebugMode.dbgRunMode    => "run",
                _                          => "design"
            };
        }
    }

    // ── Data models ───────────────────────────────────────────────────────────

    internal class DebuggerSnapshot
    {
        [System.Text.Json.Serialization.JsonPropertyName("mode")]
        public string Mode { get; set; } = "design";
        [System.Text.Json.Serialization.JsonPropertyName("currentFile")]
        public string? CurrentFile { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("currentLine")]
        public int CurrentLine { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("currentThread")]
        public string? CurrentThread { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("callStack")]
        public StackFrameInfo[]? CallStack { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("locals")]
        public LocalVar[]? Locals { get; set; }
    }

    internal class StackFrameInfo
    {
        [System.Text.Json.Serialization.JsonPropertyName("frame")]
        public int Frame { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("function")]
        public string? Function { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("module")]
        public string? Module { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("file")]
        public string? File { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("line")]
        public int? Line { get; set; }
    }

    internal class LocalVar
    {
        [System.Text.Json.Serialization.JsonPropertyName("name")]
        public string? Name { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("type")]
        public string? Type { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("value")]
        public string? Value { get; set; }
    }

    internal class PaneInfo
    {
        [System.Text.Json.Serialization.JsonPropertyName("name")]
        public string? Name { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("guid")]
        public string? Guid { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("kind")]
        public string? Kind { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("lines")]
        public int? Lines { get; set; }
    }

    internal class CommandRequest
    {
        public string? Action { get; set; }
        public string? Expression { get; set; }
        public string? File { get; set; }
        public int? Line { get; set; }
    }
}
