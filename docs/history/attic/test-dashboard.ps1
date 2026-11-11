try {
    $proc = Start-Process "D:\Projects\ClaudeDevStudio\ClaudeDevStudio.Dashboard\bin\Release\net8.0-windows10.0.19041.0\ClaudeDevStudio.Dashboard.exe" -PassThru -Wait -ErrorAction Stop
    Write-Host "Process exited with code: $($proc.ExitCode)"
} catch {
    Write-Host "Error: $_"
    Write-Host $_.Exception.Message
}

# Check for crash dumps or event logs
$ErrorActionPreference = 'SilentlyContinue'
Get-WinEvent -LogName Application -MaxEvents 5 | Where-Object { $_.ProviderName -like '*ClaudeDevStudio*' -or $_.Message -like '*ClaudeDevStudio*' } | Format-List *
