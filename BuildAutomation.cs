using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using ClaudeDevStudio.Memory;

namespace ClaudeDevStudio
{
    /// <summary>
    /// Automates building, packaging, and deployment of projects
    /// </summary>
    public class BuildAutomation
    {
        private readonly string _projectPath;
        private readonly ClaudeMemory _memory;

        public BuildAutomation(string projectPath, ClaudeMemory memory)
        {
            _projectPath = projectPath;
            _memory = memory;
        }

        /// <summary>
        /// Build project in specified configuration
        /// </summary>
        public async Task<BuildResult> BuildProjectAsync(string configuration = "Debug", string platform = "x64")
        {
            Console.WriteLine($"=== Building Project ===");
            Console.WriteLine($"Configuration: {configuration}");
            Console.WriteLine($"Platform: {platform}");
            Console.WriteLine();

            var result = new BuildResult
            {
                Configuration = configuration,
                Platform = platform,
                StartTime = DateTime.Now
            };

            try
            {
                // Find solution or project file
                var solutionFile = FindSolutionFile();
                if (solutionFile == null)
                {
                    result.Success = false;
                    result.Error = "No .sln or .csproj file found";
                    return result;
                }

                Console.WriteLine($"Building: {Path.GetFileName(solutionFile)}");

                // Run MSBuild
                var buildOutput = await RunMSBuildAsync(solutionFile, configuration, platform);
                result.Output = buildOutput;

                // Check for errors
                if (buildOutput.Contains("Build FAILED") || buildOutput.Contains("error CS"))
                {
                    result.Success = false;
                    result.ErrorCount = CountErrors(buildOutput);
                    result.WarningCount = CountWarnings(buildOutput);
                    
                    // Record failed build
                    RecordBuildActivity(result);
                }
                else if (buildOutput.Contains("Build succeeded"))
                {
                    result.Success = true;
                    result.WarningCount = CountWarnings(buildOutput);
                    
                    // Record successful build
                    RecordBuildActivity(result);
                    
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine();
                    Console.WriteLine($"OK: Build succeeded");
                    if (result.WarningCount > 0)
                        Console.WriteLine($"  {result.WarningCount} warning(s)");
                    Console.ResetColor();
                }
                else
                {
                    result.Success = false;
                    result.Error = "Build status unknown";
                }
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Error = ex.Message;
                result.Exception = ex;
            }
            finally
            {
                result.EndTime = DateTime.Now;
                result.Duration = result.EndTime - result.StartTime;
            }

            return result;
        }

        /// <summary>
        /// Create MSIX package
        /// </summary>
        public async Task<PackageResult> CreateMSIXPackageAsync()
        {
            Console.WriteLine($"=== Creating MSIX Package ===");
            Console.WriteLine();

            var result = new PackageResult
            {
                StartTime = DateTime.Now
            };

            try
            {
                // First, build in Release mode
                var buildResult = await BuildProjectAsync("Release", "x64");
                if (!buildResult.Success)
                {
                    result.Success = false;
                    result.Error = "Build failed before packaging";
                    return result;
                }

                // Find project file
                var projectFile = FindProjectFile();
                if (projectFile == null)
                {
                    result.Success = false;
                    result.Error = "No .csproj file found";
                    return result;
                }

                Console.WriteLine($"Packaging: {Path.GetFileName(projectFile)}");

                // Run packaging command
                var packageOutput = await RunPackagingAsync(projectFile);
                result.Output = packageOutput;

                if (packageOutput.Contains("successfully created") || 
                    File.Exists(FindMSIXPackage()))
                {
                    result.Success = true;
                    result.PackagePath = FindMSIXPackage();
                    
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine();
                    Console.WriteLine($"OK: Package created: {result.PackagePath}");
                    Console.ResetColor();
                }
                else
                {
                    result.Success = false;
                    result.Error = "Package creation failed";
                }
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Error = ex.Message;
                result.Exception = ex;
            }
            finally
            {
                result.EndTime = DateTime.Now;
                result.Duration = result.EndTime - result.StartTime;
            }

            return result;
        }

        /// <summary>
        /// Clean build artifacts
        /// </summary>
        public async Task<bool> CleanProjectAsync()
        {
            Console.WriteLine($"=== Cleaning Project ===");
            Console.WriteLine();

            try
            {
                var solutionFile = FindSolutionFile();
                if (solutionFile == null)
                {
                    Console.WriteLine("No solution file found");
                    return false;
                }

                var output = await RunProcessAsync("dotnet", $"clean \"{solutionFile}\"");
                Console.WriteLine(output);

                return output.Contains("Clean succeeded");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error: {ex.Message}");
                return false;
            }
        }

        #region Helper Methods

        private string FindSolutionFile()
        {
            return Directory.GetFiles(_projectPath, "*.sln").FirstOrDefault();
        }

        private string FindProjectFile()
        {
            return Directory.GetFiles(_projectPath, "*.csproj", SearchOption.AllDirectories)
                .FirstOrDefault(p => !p.Contains("\\obj\\") && !p.Contains("\\bin\\"));
        }

        private string FindMSIXPackage()
        {
            var packages = Directory.GetFiles(_projectPath, "*.msix", SearchOption.AllDirectories);
            return packages.OrderByDescending(File.GetLastWriteTime).FirstOrDefault();
        }

        private async Task<string> RunMSBuildAsync(string solutionFile, string configuration, string platform)
        {
            var args = $"build \"{solutionFile}\" -c {configuration} -p:Platform={platform}";
            return await RunProcessAsync("dotnet", args);
        }

        private async Task<string> RunPackagingAsync(string projectFile)
        {
            var args = $"publish \"{projectFile}\" -c Release -r win-x64 --self-contained";
            return await RunProcessAsync("dotnet", args);
        }

        private async Task<string> RunProcessAsync(string fileName, string arguments)
        {
            var output = new StringBuilder();

            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = fileName,
                    Arguments = arguments,
                    WorkingDirectory = _projectPath,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            process.OutputDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    output.AppendLine(e.Data);
                    Console.WriteLine(e.Data);
                }
            };

            process.ErrorDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    output.AppendLine(e.Data);
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine(e.Data);
                    Console.ResetColor();
                }
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.WaitForExitAsync();

            return output.ToString();
        }

        private int CountErrors(string output)
        {
            var matches = System.Text.RegularExpressions.Regex.Matches(output, @"error CS\d+");
            return matches.Count;
        }

        private int CountWarnings(string output)
        {
            var matches = System.Text.RegularExpressions.Regex.Matches(output, @"warning CS\d+");
            return matches.Count;
        }

        private void RecordBuildActivity(BuildResult result)
        {
            var activity = new ClaudeDevStudio.Memory.Activity
            {
                Id = $"build_{DateTime.Now:yyyyMMddHHmmss}",
                Timestamp = result.StartTime,
                Action = "build",
                Description = $"Build {result.Configuration}|{result.Platform}",
                Outcome = result.Success ? "success" : "failure",
                DurationMs = (int)result.Duration.TotalMilliseconds
            };

            if (!result.Success && result.ErrorCount > 0)
            {
                activity.Description += $" ({result.ErrorCount} errors)";
            }

            _memory.RecordActivity(activity);
        }

        #endregion
    }

    public class BuildResult
    {
        public bool Success { get; set; }
        public string Configuration { get; set; }
        public string Platform { get; set; }
        public DateTime StartTime { get; set; }
        public DateTime EndTime { get; set; }
        public TimeSpan Duration { get; set; }
        public string Output { get; set; }
        public int ErrorCount { get; set; }
        public int WarningCount { get; set; }
        public string Error { get; set; }
        public Exception Exception { get; set; }
    }

    public class PackageResult
    {
        public bool Success { get; set; }
        public DateTime StartTime { get; set; }
        public DateTime EndTime { get; set; }
        public TimeSpan Duration { get; set; }
        public string Output { get; set; }
        public string PackagePath { get; set; }
        public string Error { get; set; }
        public Exception Exception { get; set; }
    }
}
