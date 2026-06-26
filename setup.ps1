#requires -Version 5.1
<#
.SYNOPSIS
    Setup for Claude Code Control Center: installs dependencies and configures
    API keys in .env.local.

.DESCRIPTION
    Run from the project root:
        .\setup.ps1
    If PowerShell blocks scripts, run once for this process only:
        powershell -ExecutionPolicy Bypass -File .\setup.ps1
#>

[CmdletBinding()]
param(
    # Skip the interactive API-key prompts (only install dependencies + create .env.local).
    [switch]$NoPrompt
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    $msg" -ForegroundColor Yellow }

Write-Host "Claude Code Control Center - setup" -ForegroundColor White

# --- 1. Prerequisites --------------------------------------------------------
Write-Step "Checking prerequisites"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js not found on PATH. Install Node.js >= 20.9 from https://nodejs.org and re-run."
}
$nodeVersion = (& node --version).TrimStart('v')
Write-Ok "Node.js $nodeVersion"
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 20) {
    Write-Warn2 "Node 20.9+ recommended (you have $nodeVersion). Continuing anyway."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Warn2 "git not found on PATH. The app needs git for project Git status and repo push."
} else {
    Write-Ok "git $((& git --version).Replace('git version ',''))"
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Warn2 "Claude Code CLI ('claude') not found on PATH. Install and log in before using the Launcher."
} else {
    Write-Ok "Claude Code CLI found"
}

# --- 2. Install dependencies -------------------------------------------------
Write-Step "Installing dependencies (npm install)"
& npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
Write-Ok "Dependencies installed"

# --- 3. Create .env.local ----------------------------------------------------
Write-Step "Configuring .env.local"

$envExample = Join-Path $root '.env.example'
$envLocal   = Join-Path $root '.env.local'

if (-not (Test-Path $envExample)) { throw ".env.example is missing; cannot create .env.local." }

if (Test-Path $envLocal) {
    Write-Warn2 ".env.local already exists - leaving existing values untouched."
} else {
    Copy-Item $envExample $envLocal
    Write-Ok "Created .env.local from .env.example"
}

# Updates (or appends) KEY=value in the .env.local content array.
function Set-EnvValue {
    param([string[]]$Lines, [string]$Key, [string]$Value)
    $pattern = "^\s*$([regex]::Escape($Key))\s*="
    $found = $false
    $out = foreach ($line in $Lines) {
        if ($line -match $pattern) { $found = $true; "$Key=$Value" } else { $line }
    }
    if (-not $found) { $out += "$Key=$Value" }
    return $out
}

if (-not $NoPrompt) {
    $lines = Get-Content $envLocal

    Write-Host ""
    Write-Host "Enter your API keys. Press Enter to skip and keep the current value." -ForegroundColor White

    $openai = Read-Host "OPENAI_API_KEY (required for prompt improver + review)"
    if ($openai.Trim()) { $lines = Set-EnvValue -Lines $lines -Key 'OPENAI_API_KEY' -Value $openai.Trim() }

    $cartesia = Read-Host "CARTESIA_API_KEY (optional, for reading reviews aloud)"
    if ($cartesia.Trim()) { $lines = Set-EnvValue -Lines $lines -Key 'CARTESIA_API_KEY' -Value $cartesia.Trim() }

    $projects = Read-Host "PROJECTS_DIR (folder whose subfolders are your projects)"
    if ($projects.Trim()) { $lines = Set-EnvValue -Lines $lines -Key 'PROJECTS_DIR' -Value $projects.Trim() }

    Set-Content -Path $envLocal -Value $lines -Encoding UTF8
    Write-Ok "Saved configuration to .env.local"
} else {
    Write-Warn2 "-NoPrompt set: edit .env.local manually to add your API keys."
}

# --- Done --------------------------------------------------------------------
Write-Step "Setup complete"
Write-Host "    Start the dev server with:  " -NoNewline; Write-Host "npm run dev" -ForegroundColor White
Write-Host "    Then open:                  " -NoNewline; Write-Host "http://127.0.0.1:3100" -ForegroundColor White
