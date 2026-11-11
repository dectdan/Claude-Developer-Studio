# cds-path.ps1 -- adds or removes one folder in the user PATH (HKCU\Environment\Path) and
# changes nothing else in it: the value keeps its type (REG_EXPAND_SZ stays expandable,
# %VARIABLES% are not expanded), its order and its other entries. Run by the installer
# and uninstaller. (NSIS strings stop at 1024 characters, too short for a long PATH.)
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File cds-path.ps1 -Action add|remove -Dir <folder> [-Log <file>]

param(
    [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
    [Parameter(Mandatory = $true)][string]$Dir,
    [string]$Log = '',
    # Tests only: another HKCU key with a Path value (tools\sandbox-test).
    [string]$RegistryKey = 'Environment'
)

function Write-Log([string]$Message) {
    Write-Output $Message
    if ($Log) {
        try {
            $line = '{0}  {1}{2}' -f (Get-Date -Format 's'), $Message, [Environment]::NewLine
            [System.IO.File]::AppendAllText($Log, $line, (New-Object System.Text.UTF8Encoding $false))
        } catch { }
    }
}

function Get-Normal([string]$Entry) { return $Entry.Trim().Trim('"').TrimEnd('\') }

try {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($RegistryKey)
    $name = $key.GetValueNames() | Where-Object { $_ -ieq 'Path' } | Select-Object -First 1
    if ($name) {
        $raw = [string]$key.GetValue($name, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $kind = $key.GetValueKind($name)
    } else {
        $name = 'Path'
        $raw = ''
        $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    }

    $target = Get-Normal $Dir
    $parts = $raw -split ';'
    $present = @($parts | Where-Object { $_ -and ((Get-Normal $_) -ieq $target) }).Count -gt 0

    if ($Action -eq 'add') {
        if ($present) { Write-Log "PATH already has $Dir; not changed."; exit 0 }
        if ($raw -eq '') { $new = $Dir }
        elseif ($raw.EndsWith(';')) { $new = $raw + $Dir }
        else { $new = $raw + ';' + $Dir }
        $key.SetValue($name, $new, $kind)
        Write-Log "Added $Dir to the user PATH."
    } else {
        if (-not $present) { Write-Log "PATH does not have $Dir; not changed."; exit 0 }
        $kept = @($parts | Where-Object { -not ($_ -and ((Get-Normal $_) -ieq $target)) })
        $key.SetValue($name, ($kept -join ';'), $kind)
        Write-Log "Removed $Dir from the user PATH."
    }
    $key.Close()
} catch {
    Write-Log "PATH not changed after an error: $($_.Exception.Message)"
    exit 1
}
exit 0
