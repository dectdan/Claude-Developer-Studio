# ClaudeDevStudio - Program.cs Updates for Version Checking

## Add to line 63 (after "sync" => SyncProject(args),):
```csharp
                    "version" => ShowVersion(args),
```

## Add to ShowHelp() function (after line 1086, before "help"):
```csharp
            Console.WriteLine("  version                  Check for updates");
```

## Add this new function after SyncProject (around line 1027):
```csharp
        static int ShowVersion(string[] args)
        {
            const string VERSION = "1.0.0";
            Console.WriteLine($"ClaudeDevStudio v{VERSION}");
            Console.WriteLine();

            // Check for updates
            var checkUpdate = args.Length > 1 && args[1] == "--check-update";
            
            if (checkUpdate || true) // Always check on version command
            {
                Console.WriteLine("Checking for updates...");
                var updateTask = UpdateChecker.CheckForUpdatesAsync();
                updateTask.Wait();
                var update = updateTask.Result;

                if (update.UpdateAvailable)
                {
                    Console.ForegroundColor = ConsoleColor.Yellow;
                    Console.WriteLine($"
🎉 Update available: v{update.LatestVersion}");
                    Console.ResetColor();
                    Console.WriteLine($"   Download: {update.DownloadUrl}");
                    Console.WriteLine();
                    if (!string.IsNullOrEmpty(update.ReleaseNotes))
                    {
                        Console.WriteLine("What's new:");
                        Console.WriteLine(update.ReleaseNotes);
                    }
                }
                else
                {
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("✓ You're running the latest version");
                    Console.ResetColor();
                }
            }

            return 0;
        }
```

## Usage:
```powershell
claudedev version              # Show version and check for updates
claudedev version --check-update  # Same as above
```
