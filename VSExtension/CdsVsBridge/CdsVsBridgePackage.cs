using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Task = System.Threading.Tasks.Task;

namespace CdsVsBridge
{
    /// <summary>
    /// CDS VS Bridge Package — loads automatically when a solution opens and
    /// wires up build/debugger/solution events to write state files for Claude.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [Guid(PackageGuidString)]
    [ProvideAutoLoad(VSConstants.UICONTEXT.SolutionExists_string, PackageAutoLoadFlags.BackgroundLoad)]
    public sealed class CdsVsBridgePackage : AsyncPackage
    {
        public const string PackageGuidString = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

        // Hold strong references — VS events use weak refs internally and will be GC'd otherwise
        private DTE2? _dte;
        private BuildEvents? _buildEvents;
        private DebuggerEvents? _debuggerEvents;
        private SolutionEvents? _solutionEvents;
        private DocumentEvents? _documentEvents;
        private DTEEvents? _dteEvents;
        private VsBridgeServer? _httpServer;

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await base.InitializeAsync(cancellationToken, progress);

            // Switch to UI thread to access DTE
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            _dte = await GetServiceAsync(typeof(DTE)) as DTE2;
            if (_dte == null) return;

            WireUpEvents();

            // Start HTTP server for two-way VS control
            _httpServer = new VsBridgeServer(_dte, this);
            _httpServer.Start();

            // Write initial state on load
            WriteCurrentState();
            VsEventLogger.Log("extension_loaded", new { version = "1.0.0" });

            // If a solution was already open when the package loaded, log it now
            // (OnSolutionOpened won't fire retroactively)
            try
            {
                var solutionFile = _dte?.Solution?.FileName;
                if (!string.IsNullOrEmpty(solutionFile))
                    VsEventLogger.Log("solution_already_open", new { solution = solutionFile });
            }
            catch { }
        }

        private void WireUpEvents()
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            var events = _dte!.Events;

            // Build events
            _buildEvents = events.BuildEvents;
            _buildEvents.OnBuildBegin += OnBuildBegin;
            _buildEvents.OnBuildDone += OnBuildDone;

            // Debugger events
            _debuggerEvents = events.DebuggerEvents;
            _debuggerEvents.OnEnterBreakMode += OnEnterBreakMode;
            _debuggerEvents.OnEnterRunMode += OnEnterRunMode;
            _debuggerEvents.OnEnterDesignMode += OnEnterDesignMode;

            // Solution events
            _solutionEvents = events.SolutionEvents;
            _solutionEvents.Opened += OnSolutionOpened;
            _solutionEvents.BeforeClosing += OnSolutionClosing;

            // Document events — track active file
            _documentEvents = events.DocumentEvents;
            _documentEvents.DocumentSaved += OnDocumentSaved;
        }

        // ── Build events ──────────────────────────────────────────────────────

        private void OnBuildBegin(vsBuildScope scope, vsBuildAction action)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            VsStateWriter.ClearBuildOutput();
            VsEventLogger.Log("build_started", new
            {
                scope = scope.ToString(),
                action = action.ToString(),
                config = _dte?.Solution?.SolutionBuild?.ActiveConfiguration?.Name
            });
        }

        private void OnBuildDone(vsBuildScope scope, vsBuildAction action)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var build = _dte?.Solution?.SolutionBuild;
                var errors = new List<VsErrorItem>();
                var warnings = new List<VsErrorItem>();

                // Walk the Error List
                var errorItems = _dte?.ToolWindows?.ErrorList?.ErrorItems;
                if (errorItems != null)
                {
                    for (int i = 1; i <= errorItems.Count; i++)
                    {
                        var item = errorItems.Item(i);
                        var entry = new VsErrorItem
                        {
                            File = item.FileName,
                            Line = item.Line,
                            Col = item.Column,
                            Message = item.Description,
                            Project = item.Project,
                            Severity = item.ErrorLevel == vsBuildErrorLevel.vsBuildErrorLevelHigh
                                ? "error" : "warning"
                        };

                        if (item.ErrorLevel == vsBuildErrorLevel.vsBuildErrorLevelHigh)
                            errors.Add(entry);
                        else
                            warnings.Add(entry);
                    }
                }

                var succeeded = build?.LastBuildInfo == 0;
                var snapshot = new VsErrorSnapshot
                {
                    BuildResult = succeeded ? "succeeded" : "failed",
                    ErrorCount = errors.Count,
                    WarningCount = warnings.Count,
                    Errors = errors.ToArray(),
                    Warnings = warnings.ToArray()
                };

                VsStateWriter.WriteErrors(snapshot);
                VsEventLogger.Log("build_" + (succeeded ? "succeeded" : "failed"), new
                {
                    errorCount = errors.Count,
                    warningCount = warnings.Count
                });

                // Capture build output pane text
                try
                {
                    var outputWindow = _dte?.ToolWindows?.OutputWindow;
                    if (outputWindow != null)
                    {
                        OutputWindowPane? buildPane = null;
                        foreach (OutputWindowPane pane in outputWindow.OutputWindowPanes)
                        {
                            if (pane.Name == "Build")
                            {
                                buildPane = pane;
                                break;
                            }
                        }
                        if (buildPane != null)
                        {
                            var doc   = buildPane.TextDocument;
                            var start = doc.StartPoint.CreateEditPoint();
                            var text  = start.GetText(doc.EndPoint);
                            VsStateWriter.AppendBuildOutput(text);
                        }
                    }
                }
                catch { /* Output pane capture failed — non-fatal */ }
            }
            catch { }
        }

        // ── Debugger events ───────────────────────────────────────────────────

        private void OnEnterBreakMode(dbgEventReason reason, ref dbgExecutionAction action)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var dbg = _dte?.Debugger as Debugger2;
                string? exMsg = null;

                // Capture exception message if that's why we broke
                if (reason == dbgEventReason.dbgEventReasonExceptionThrown ||
                    reason == dbgEventReason.dbgEventReasonExceptionNotHandled)
                {
                    exMsg = TryGetExceptionMessage(dbg);
                }

                var state = BuildStateSnapshot();
                state.DebugMode = "break";
                state.BreakReason = reason.ToString().Replace("dbgEventReason", "");
                state.ExceptionMessage = exMsg;

                if (dbg?.CurrentThread != null)
                    state.CurrentThread = dbg.CurrentThread.Name;

                VsStateWriter.WriteState(state);
                VsEventLogger.Log("debugger_break", new
                {
                    reason = state.BreakReason,
                    file = state.ActiveFile,
                    line = state.ActiveLine,
                    exception = exMsg
                });
            }
            catch { }
        }

        private void OnEnterRunMode(dbgEventReason reason)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var state = BuildStateSnapshot();
            state.DebugMode = "run";
            VsStateWriter.WriteState(state);
            VsEventLogger.Log("debugger_go", new { reason = reason.ToString() });
        }

        private void OnEnterDesignMode(dbgEventReason reason)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var state = BuildStateSnapshot();
            state.DebugMode = "design";
            VsStateWriter.WriteState(state);
            VsEventLogger.Log("debugger_stop", new { reason = reason.ToString() });
        }

        // ── Solution events ───────────────────────────────────────────────────

        private void OnSolutionOpened()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            WriteCurrentState();
            VsEventLogger.Log("solution_opened", new
            {
                solution = _dte?.Solution?.FileName
            });
        }

        private void OnSolutionClosing()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            VsEventLogger.Log("solution_closing", new
            {
                solution = _dte?.Solution?.FileName
            });
        }

        private void OnDocumentSaved(Document document)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var state = BuildStateSnapshot();
                VsStateWriter.WriteState(state);
            }
            catch { }
        }

        // ── Helpers ───────────────────────────────────────────────────────────

        private VsStateSnapshot BuildStateSnapshot()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var snap = new VsStateSnapshot
            {
                Solution = _dte?.Solution?.FileName
            };

            try
            {
                var activeDoc = _dte?.ActiveDocument;
                if (activeDoc != null)
                {
                    snap.ActiveFile = activeDoc.FullName;
                    var sel = activeDoc.Selection as TextSelection;
                    if (sel != null)
                        snap.ActiveLine = sel.CurrentLine;
                }
            }
            catch { }

            return snap;
        }

        private void WriteCurrentState()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var state = BuildStateSnapshot();
            VsStateWriter.WriteState(state);
        }

        private static string? TryGetExceptionMessage(Debugger2? dbg)
        {
            try
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                // Evaluate $exception in the current context to get message
                var expr = dbg?.GetExpression("$exception", true, 500);
                if (expr != null && expr.IsValidValue)
                    return expr.Value;
            }
            catch { }
            return null;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                // Unwire events to prevent crashes on VS shutdown
                try
                {
                    if (_buildEvents != null)
                    {
                        _buildEvents.OnBuildBegin -= OnBuildBegin;
                        _buildEvents.OnBuildDone -= OnBuildDone;
                    }
                    if (_debuggerEvents != null)
                    {
                        _debuggerEvents.OnEnterBreakMode -= OnEnterBreakMode;
                        _debuggerEvents.OnEnterRunMode -= OnEnterRunMode;
                        _debuggerEvents.OnEnterDesignMode -= OnEnterDesignMode;
                    }
                    if (_solutionEvents != null)
                    {
                        _solutionEvents.Opened -= OnSolutionOpened;
                        _solutionEvents.BeforeClosing -= OnSolutionClosing;
                    }
                    if (_documentEvents != null)
                    {
                        _documentEvents.DocumentSaved -= OnDocumentSaved;
                    }
                    _httpServer?.Dispose();
                }
                catch { }
            }
            base.Dispose(disposing);
        }
    }
}
