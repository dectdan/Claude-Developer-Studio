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
            resp.Headers.Add("Access-Control-Allow-Origin", "*");

            try
            {
                string body;
                var path = req.Url?.AbsolutePath.TrimEnd('/') ?? "";

                if (req.HttpMethod == "GET" && path == "/state")
                    body = await GetStateJsonAsync();
                else if (req.HttpMethod == "GET" && path == "/errors")
                    body = GetErrorsJson();
                else if (req.HttpMethod == "GET" && path == "/output")
                    body = GetOutputJson(req);
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

    internal class CommandRequest
    {
        public string? Action { get; set; }
        public string? Expression { get; set; }
        public string? File { get; set; }
        public int? Line { get; set; }
    }
}
