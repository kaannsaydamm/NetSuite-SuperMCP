param(
  [switch]$AllKnown,
  [switch]$AllDetected,
  [string]$Target,
  [switch]$List
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw "Bun is required. Install Bun, reopen the terminal, then run setup again."
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example. Fill the NetSuite OAuth values before live use."
}

bun install

$installerArgs = @()
if ($List) {
  $installerArgs += "--list"
} elseif ($Target) {
  $installerArgs += "--target=$Target"
} elseif ($AllKnown) {
  $installerArgs += "--all-known"
} elseif ($AllDetected) {
  $installerArgs += "--all-detected"
} else {
  $installerArgs += "--all-detected"
}

bun run install:clients -- @installerArgs

Write-Host ""
Write-Host "Setup finished. SuperMCP only registered MCP servers; client approval settings remain in each client."
Write-Host "Next: edit .env with NetSuite OAuth values, deploy the RESTlet files, then run ns_checkAccountPermissions."
