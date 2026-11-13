# Compile the starter app (or another entry) to a native Windows executable
# and open it.
#
#   powershell -File examples/starter/build.ps1
#   powershell -File examples/starter/build.ps1 -Entry path\to\App.tsx -Name MyApp -Title "My app"
#   powershell -File examples/starter/build.ps1 -Config path\to\reactc.config.json
#
# Run from anywhere; paths are relative to the repository root.
param(
    [string]$Config = '',
    [string]$Entry = 'examples/starter/App.tsx',
    [string]$Name = 'StarterApp',
    [string]$Title = 'My tasks',
    [string]$OutDir = '',
    [switch]$NoRun
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
if (-not $OutDir) { $OutDir = "dist/$Name" }

# Build the compiler once (and again after compiler changes).
cargo build --locked --manifest-path compiler/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Building reactc failed' }

if ($Config) {
    # A project configuration names its server and client folders and entries.
    & compiler/target/debug/reactc.exe build --config $Config
    if ($LASTEXITCODE -ne 0) { throw "Building $Config failed" }
    return
}

# Forms need async page mode; it is harmless for apps without forms.
& compiler/target/debug/reactc.exe build $Entry --async-page --target windows --name $Name --title $Title --outdir $OutDir
if ($LASTEXITCODE -ne 0) { throw "Compiling $Entry failed" }

$exe = Join-Path $OutDir "$Name.exe"
Write-Host "Built $exe"
if (-not $NoRun) { Start-Process -FilePath (Resolve-Path $exe) -WorkingDirectory (Resolve-Path $OutDir) }
