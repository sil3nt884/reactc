# Compile this project with reactc, and optionally run it. Needs only PowerShell.
#
#   powershell -ExecutionPolicy Bypass -File build.ps1                 # server and client
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Only client    # one side
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Start          # build, then run both
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Start -NoBuild # run the last build
#
# reactc is found from reactc.config.json "root" (a packaged reactc with
# bin\reactc.exe, or the reactc checkout), then REACTC_HOME, then PATH.
param(
    [ValidateSet('', 'server', 'client')]
    [string]$Only = '',
    [switch]$Start,
    [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$config = Get-Content -Raw reactc.config.json | ConvertFrom-Json

function Find-Reactc {
    $candidates = @()
    if ($config.root) {
        # "root" may be absolute (generated projects) or relative to this folder.
        $root = if ([System.IO.Path]::IsPathRooted($config.root)) { $config.root } else { Join-Path $PSScriptRoot $config.root }
        $root = [System.IO.Path]::GetFullPath($root)
        $candidates += Join-Path $root 'bin\reactc.exe'
        # in a reactc checkout: the newer of the release and debug builds
        $built = @('compiler\target\release\reactc.exe', 'compiler\target\debug\reactc.exe') |
            ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ } |
            Sort-Object { (Get-Item $_).LastWriteTime } -Descending
        $candidates += @($built)
    }
    if ($env:REACTC_HOME) { $candidates += Join-Path $env:REACTC_HOME 'bin\reactc.exe' }
    foreach ($candidate in $candidates) { if (Test-Path $candidate) { return $candidate } }
    $onPath = Get-Command reactc -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    if ($config.root -and (Test-Path (Join-Path $root 'compiler\Cargo.toml'))) {
        Write-Host 'Building reactc in the checkout (first run only)...'
        cargo build --locked --manifest-path (Join-Path $root 'compiler\Cargo.toml')
        if ($LASTEXITCODE -ne 0) { throw 'Building reactc failed' }
        return Join-Path $root 'compiler\target\debug\reactc.exe'
    }
    throw 'reactc not found: set "root" in reactc.config.json to a reactc folder, set REACTC_HOME, or put reactc on PATH'
}

# Windows executables go to distwindows, like npm run build:windows.
$outDir = Join-Path (Join-Path $PSScriptRoot $config.outDir) 'windows'

if (-not $NoBuild) {
    $reactc = Find-Reactc
    $arguments = @('build', '--config', (Join-Path $PSScriptRoot 'reactc.config.json'), '--target', 'windows', '--outdir', $outDir)
    if ($Only) { $arguments += @('--only', $Only) }
    & $reactc @arguments
    if ($LASTEXITCODE -ne 0) { throw 'The build failed' }
}

if ($Start) {
    $serverExe = Join-Path $outDir ('server\' + $config.server.name + '.exe')
    $clientExe = Join-Path $outDir ('client\' + $config.client.name + '.exe')
    foreach ($file in @($serverExe, $clientExe)) { if (-not (Test-Path $file)) { throw "Missing $file; build first" } }
    $data = Join-Path $PSScriptRoot 'data'   # tasks.json is saved here
    New-Item -ItemType Directory -Force $data | Out-Null
    $server = Start-Process -FilePath $serverExe -WorkingDirectory $data -PassThru -NoNewWindow
    try {
        $deadline = (Get-Date).AddSeconds(15)
        while ($true) {
            try { Invoke-RestMethod ($config.client.httpOrigin + '/health') -TimeoutSec 2 | Out-Null; break }
            catch {
                if ($server.HasExited -or (Get-Date) -gt $deadline) { throw 'The server did not start' }
                Start-Sleep -Milliseconds 200
            }
        }
        $client = Start-Process -FilePath $clientExe -WorkingDirectory (Split-Path $clientExe) -PassThru
        $client.WaitForExit()
    } finally {
        if (-not $server.HasExited) { Stop-Process -Id $server.Id }
    }
}
