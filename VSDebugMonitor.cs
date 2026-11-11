using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using ClaudeDevStudio.Memory;

namespace ClaudeDevStudio
{
    /// <summary>
    /// Monitors Visual Studio debug output and captures exceptions/errors
    /// </summary>
    public class VSDebugMonitor
    {
        private readonly string _projectPath;
        private readonly ClaudeMemory _memory;
        private readonly List<DebugOutputLine> _capturedOutput;
        private readonly object _lock = new object();
        private bool _isMonitoring;
        private CancellationTokenSource _cancellationSource;

        public VSDebugMonitor(string projectPath, ClaudeMemory memory)
        {
            _projectPath = projectPath;
            _memory = memory;
            _capturedOutput = new List<DebugOutputLine>();
        }

        /// <summary>
        /// Start monitoring Visual Studio debug output
        /// </summary>
        public async Task StartMonitoringAsync()
        {
            if (_isMonitoring)
            {
                Console.WriteLine("Already monitoring debug output.");
                return;
            }

            _isMonitoring = true;
            _cancellationSource = new CancellationTokenSource();

            Console.WriteLine("=== VS Debug Monitor Started ===");
            Console.WriteLine("Monitoring for exceptions and errors...");
            Console.WriteLine("Press Ctrl+C to stop monitoring");
            Console.WriteLine();

            // Start monitoring task
            await Task.Run(() => MonitorDebugOutput(_cancellationSource.Token));
        }

        /// <summary>
        /// Stop monitoring
        /// </summary>
        public void StopMonitoring()
        {
            if (!_isMonitoring) return;

            _cancellationSource?.Cancel();
            _isMonitoring = false;

            Console.WriteLine();
            Console.WriteLine("=== VS Debug Monitor Stopped ===");
            Console.WriteLine($"Total lines captured: {_capturedOutput.Count}");
            
            var exceptions = _capturedOutput.Count(l => l.Type == OutputType.Exception);
            var errors = _capturedOutput.Count(l => l.Type == OutputType.Error);
            
            if (exceptions > 0)
                Console.WriteLine($"Exceptions captured: {exceptions}");
            if (errors > 0)
                Console.WriteLine($"Errors captured: {errors}");
        }

        /// <summary>
        /// Monitor debug output using DebugView
        /// </summary>
        private void MonitorDebugOutput(CancellationToken cancellationToken)
        {
            // DebugView is Microsoft's (Sysinternals) and may not be redistributed, so
            // ClaudeDevStudio doesn't ship it. Look in CDS's DebugView folder, then on PATH.
            var installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeDevStudio", "DebugView");
            var debugViewPath = FindDebugView(installDir);

            if (debugViewPath == null)
            {
                Console.WriteLine("ERROR: DebugView not found.");
                Console.WriteLine();
                Console.WriteLine("The debug monitor needs Sysinternals DebugView, which ClaudeDevStudio does not include.");
                Console.WriteLine("Download it from Microsoft: https://learn.microsoft.com/sysinternals/downloads/debugview");
                Console.WriteLine($"Then put dbgview64.exe in {installDir}");
                Console.WriteLine("or in any folder on your PATH, and run the monitor again.");
                return;
            }

            // Create temp log file for DebugView output
            var logFile = Path.Combine(Path.GetTempPath(), $"claudedev_debug_{Guid.NewGuid()}.log");

            try
            {
                // Launch DebugView with logging to file
                var startInfo = new ProcessStartInfo
                {
                    FileName = debugViewPath,
                    Arguments = $"/l \"{logFile}\" /t /n",  // /l=log to file, /t=timestamps, /n=no auto-scroll
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = Process.Start(startInfo);
                if (process == null)
                {
                    Console.WriteLine("Failed to start DebugView");
                    return;
                }

                Console.WriteLine($"DebugView started (PID: {process.Id})");
                Console.WriteLine($"Monitoring debug output...");
                Console.WriteLine();

                // Wait for log file to be created
                var timeout = DateTime.Now.AddSeconds(5);
                while (!File.Exists(logFile) && DateTime.Now < timeout)
                {
                    Thread.Sleep(100);
                }

                if (!File.Exists(logFile))
                {
                    Console.WriteLine("Warning: Log file not created, monitoring may not work");
                }

                // Monitor the log file
                long lastPosition = 0;
                while (!cancellationToken.IsCancellationRequested)
                {
                    try
                    {
                        if (File.Exists(logFile))
                        {
                            using var fs = new FileStream(logFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                            if (fs.Length > lastPosition)
                            {
                                fs.Seek(lastPosition, SeekOrigin.Begin);
                                using var reader = new StreamReader(fs);
                                
                                string? line;
                                while ((line = reader.ReadLine()) != null)
                                {
                                    ProcessOutputLine(line);
                                }
                                
                                lastPosition = fs.Position;
                            }
                        }
                    }
                    catch (IOException)
                    {
                        // File locked, try again
                    }

                    Thread.Sleep(100);
                }

                // Cleanup
                if (!process.HasExited)
                {
                    process.Kill();
                    process.WaitForExit(1000);
                }
            }
            finally
            {
                // Delete temp log file
                try
                {
                    if (File.Exists(logFile))
                        File.Delete(logFile);
                }
                catch { }
            }
        }

        /// <summary>
        /// dbgview64.exe in CDS's DebugView folder, else the first one on PATH; null if none
        /// </summary>
        private static string? FindDebugView(string installDir)
        {
            var candidate = Path.Combine(installDir, "dbgview64.exe");
            if (File.Exists(candidate)) return candidate;

            var pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (var dir in pathVar.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            {
                try
                {
                    candidate = Path.Combine(dir.Trim().Trim('"'), "dbgview64.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException) { /* a malformed PATH entry */ }
            }
            return null;
        }

        /// <summary>
        /// Process a line of debug output
        /// </summary>
        internal void ProcessOutputLine(string line)
        {
            if (string.IsNullOrWhiteSpace(line)) return;

            var outputLine = new DebugOutputLine
            {
                Timestamp = DateTime.Now,
                Text = line,
                Type = ClassifyOutput(line)
            };

            lock (_lock)
            {
                _capturedOutput.Add(outputLine);
            }

            // If it's an exception or error, process it immediately
            if (outputLine.Type == OutputType.Exception || outputLine.Type == OutputType.Error)
            {
                ProcessError(outputLine);
            }
        }

        /// <summary>
        /// Classify output line type
        /// </summary>
        private OutputType ClassifyOutput(string line)
        {
            // Exception patterns
            if (Regex.IsMatch(line, @"Exception|exception", RegexOptions.IgnoreCase) ||
                line.Contains("at ") && line.Contains(" in ") && line.Contains(":line"))
            {
                return OutputType.Exception;
            }

            // Error patterns
            if (Regex.IsMatch(line, @"^Error|ERROR:|error CS\d+", RegexOptions.IgnoreCase))
            {
                return OutputType.Error;
            }

            // Warning patterns
            if (Regex.IsMatch(line, @"^Warning|WARNING:|warning CS\d+", RegexOptions.IgnoreCase))
            {
                return OutputType.Warning;
            }

            return OutputType.Info;
        }

        /// <summary>
        /// Process an error or exception
        /// </summary>
        private void ProcessError(DebugOutputLine outputLine)
        {
            Console.ForegroundColor = outputLine.Type == OutputType.Exception 
                ? ConsoleColor.Red 
                : ConsoleColor.Yellow;
            
            Console.WriteLine($"[{outputLine.Timestamp:HH:mm:ss}] {outputLine.Type}: {outputLine.Text}");
            Console.ResetColor();

            // Try to parse as exception
            var exception = TryParseException(outputLine);
            if (exception != null)
            {
                RecordException(exception);
            }
        }

        /// <summary>
        /// Try to parse exception from output
        /// </summary>
        private ParsedException TryParseException(DebugOutputLine line)
        {
            var text = line.Text;
            
            // Pattern: "System.NullReferenceException: Object reference not set..."
            var exMatch = Regex.Match(text, @"^([\w\.]+Exception):\s*(.+)$");
            if (exMatch.Success)
            {
                return new ParsedException
                {
                    Type = exMatch.Groups[1].Value,
                    Message = exMatch.Groups[2].Value,
                    Timestamp = line.Timestamp
                };
            }

            // Pattern: "   at Namespace.Class.Method() in C:\Path\File.cs:line 123"
            var stackMatch = Regex.Match(text, @"at\s+(.+?)\s+in\s+(.+):line\s+(\d+)");
            if (stackMatch.Success)
            {
                return new ParsedException
                {
                    Type = "StackTrace",
                    Method = stackMatch.Groups[1].Value,
                    File = stackMatch.Groups[2].Value,
                    Line = int.Parse(stackMatch.Groups[3].Value),
                    Timestamp = line.Timestamp
                };
            }

            return null;
        }

        /// <summary>
        /// Record exception to memory
        /// </summary>
        private void RecordException(ParsedException exception)
        {
            try
            {
                var activity = new ClaudeDevStudio.Memory.Activity
                {
                    Id = $"exc_{DateTime.Now:yyyyMMddHHmmss}_{new Random().Next(1000, 9999)}",
                    Timestamp = exception.Timestamp,
                    Action = "exception",
                    Description = $"{exception.Type}: {exception.Message}",
                    File = exception.File,
                    Line = exception.Line,
                    Outcome = "failure"
                };

                _memory.RecordActivity(activity);
                
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine($"  ✓ Recorded to memory: {activity.Id}");
                Console.ResetColor();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"  ✗ Failed to record: {ex.Message}");
            }
        }

        /// <summary>
        /// Get all captured output
        /// </summary>
        public List<DebugOutputLine> GetCapturedOutput()
        {
            lock (_lock)
            {
                return new List<DebugOutputLine>(_capturedOutput);
            }
        }

        /// <summary>
        /// Get exceptions only
        /// </summary>
        public List<DebugOutputLine> GetExceptions()
        {
            lock (_lock)
            {
                return _capturedOutput.Where(l => l.Type == OutputType.Exception).ToList();
            }
        }

        /// <summary>
        /// Export captured output to file
        /// </summary>
        public void ExportToFile(string filePath)
        {
            lock (_lock)
            {
                var lines = _capturedOutput.Select(l => 
                    $"[{l.Timestamp:yyyy-MM-dd HH:mm:ss}] [{l.Type}] {l.Text}");
                
                File.WriteAllLines(filePath, lines);
                Console.WriteLine($"Exported {_capturedOutput.Count} lines to {filePath}");
            }
        }
    }

    /// <summary>
    /// Custom debug listener for Visual Studio output
    /// </summary>
    internal class VSDebugListener : TraceListener
    {
        private readonly VSDebugMonitor _monitor;

        public VSDebugListener(VSDebugMonitor monitor)
        {
            _monitor = monitor;
        }

        public override void Write(string message)
        {
            if (!string.IsNullOrEmpty(message))
            {
                _monitor.ProcessOutputLine(message);
            }
        }

        public override void WriteLine(string message)
        {
            if (!string.IsNullOrEmpty(message))
            {
                _monitor.ProcessOutputLine(message);
            }
        }
    }

    /// <summary>
    /// Debug output line
    /// </summary>
    public class DebugOutputLine
    {
        public DateTime Timestamp { get; set; }
        public string Text { get; set; }
        public OutputType Type { get; set; }
    }

    /// <summary>
    /// Output type classification
    /// </summary>
    public enum OutputType
    {
        Info,
        Warning,
        Error,
        Exception
    }

    /// <summary>
    /// Parsed exception information
    /// </summary>
    public class ParsedException
    {
        public DateTime Timestamp { get; set; }
        public string Type { get; set; }
        public string Message { get; set; }
        public string Method { get; set; }
        public string File { get; set; }
        public int? Line { get; set; }
    }
}
