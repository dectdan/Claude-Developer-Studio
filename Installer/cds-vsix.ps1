# cds-vsix.ps1 -- installs or removes the CDS VS Bridge (VSIX) in every Visual Studio
# that vswhere finds and that has VSIXInstaller.exe. Run by the installer and uninstaller.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File cds-vsix.ps1 -Action install -Vsix <file.vsix> [-Log <file>]
#   powershell -NoProfile -ExecutionPolicy Bypass -File cds-vsix.ps1 -Action uninstall [-Log <file>]
#   add -ListOnly to see what it would run without running it
#
# Never fails the install: no Visual Studio, no vswhere, or a refused install is logged
# and the script still exits 0.

param(
    [Parameter(Mandatory = $true)][ValidateSet('install', 'uninstall')][string]$Action,
    [string]$Vsix = '',
    [string]$Log = '',
    # Prints what would run and runs nothing (for checking on a developer PC).
    [switch]$ListOnly
)

$ExtensionId = 'CdsVsBridge.DanGain.ClaudeDevStudio'
$TimeoutSec = 300

function Write-Log([string]$Message) {
    Write-Output $Message
    if ($Log) {
        try {
            $line = '{0}  {1}{2}' -f (Get-Date -Format 's'), $Message, [Environment]::NewLine
            [System.IO.File]::AppendAllText($Log, $line, (New-Object System.Text.UTF8Encoding $false))
        } catch { }
    }
}

# VSIXInstaller exit codes worth naming in the log. 2003 is NoApplicableSKUsException ("This
# extension is not installable on any currently installed products"), seen in VSIXInstaller's
# own logs (%TEMP%\dd_VSIXInstaller_*.log) for Build Tools 2019 and 2022; before v1.4.0 this
# table called it "Visual Studio is running", which was wrong. Other codes: see those logs.
$Meaning = @{
    0    = 'done'
    1001 = 'already installed'
    1002 = 'not installed'
    2003 = 'not installable on this product (VSIXInstaller: no applicable product)'
}
$LogHint = 'not done; VSIXInstaller''s log: %TEMP%\dd_VSIXInstaller_*.log'

try {
    Write-Log "VS Bridge ($Action):"
    $pf86 = ${env:ProgramFiles(x86)}
    if (-not $pf86) { $pf86 = $env:ProgramFiles }
    $vswhere = Join-Path $pf86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) {
        Write-Log '  Skipped: Visual Studio not found (no vswhere.exe). The VS Bridge is optional.'
        exit 0
    }
    if ($Action -eq 'install' -and -not (Test-Path -LiteralPath $Vsix)) {
        Write-Log "  Skipped: the VSIX is missing ($Vsix)."
        exit 0
    }

    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $json = (& $vswhere -all -prerelease -products '*' -format json -utf8) -join "`n"
    $instances = @()
    # Windows PowerShell 5.1 emits a JSON array as one object; assigning it first and
    # piping it lists the instances one by one.
    if ($json.Trim()) { $parsed = ConvertFrom-Json $json; $instances = @($parsed | ForEach-Object { $_ }) }

    $found = 0
    foreach ($vs in $instances) {
        $installer = Join-Path $vs.installationPath 'Common7\IDE\VSIXInstaller.exe'
        if (-not (Test-Path -LiteralPath $installer)) { continue }
        $found++
        $name = '{0} {1} ({2})' -f $vs.displayName, $vs.installationVersion, $vs.instanceId
        # Build Tools has VSIXInstaller.exe but no IDE: it can't host extensions (VSIXInstaller
        # refuses with 2003 after a few seconds), so it is skipped and said so.
        if ($vs.productId -eq 'Microsoft.VisualStudio.Product.BuildTools') {
            Write-Log "  $name : skipped: Build Tools can't host extensions (the VS Bridge needs the Visual Studio IDE)."
            continue
        }
        if ($Action -eq 'install') {
            $argList = @('/quiet', "/instanceIds:$($vs.instanceId)", "`"$Vsix`"")
        } else {
            $argList = @('/quiet', "/instanceIds:$($vs.instanceId)", "/uninstall:$ExtensionId")
        }
        if ($ListOnly) { Write-Log "  $name : would run $installer $($argList -join ' ')"; continue }
        $p = Start-Process -FilePath $installer -ArgumentList $argList -PassThru -WindowStyle Hidden
        if (-not $p.WaitForExit($TimeoutSec * 1000)) {
            try { $p.Kill() } catch { }
            Write-Log "  $name : no answer after $TimeoutSec s, stopped. Install the VSIX by hand if you need it."
            continue
        }
        $code = $p.ExitCode
        $what = $Meaning[$code]
        if (-not $what) { $what = $LogHint }
        Write-Log "  $name : exit $code ($what)"
    }
    if ($found -eq 0) { Write-Log '  Skipped: no Visual Studio with VSIXInstaller.exe found.' }
} catch {
    Write-Log "  Skipped after an error: $($_.Exception.Message)"
}
exit 0
