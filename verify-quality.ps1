Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root 'frontend'
$backend = Join-Path $root 'backend'

function Invoke-NpmStep {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  if (-not (Test-Path $WorkingDirectory)) {
    throw "Working directory not found: $WorkingDirectory"
  }

  Write-Host ''
  Write-Host "==> $Name" -ForegroundColor Cyan

  Push-Location $WorkingDirectory
  try {
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Step failed: $Name (exit code $LASTEXITCODE)"
    }
  }
  finally {
    Pop-Location
  }
}

Write-Host "Quality gate root: $root" -ForegroundColor DarkGray

try {
  Invoke-NpmStep -Name 'Frontend typecheck' -WorkingDirectory $frontend -Arguments @('run', 'typecheck')
  Invoke-NpmStep -Name 'Frontend lint' -WorkingDirectory $frontend -Arguments @('run', 'lint')
  Invoke-NpmStep -Name 'Frontend architecture check' -WorkingDirectory $frontend -Arguments @('run', 'arch:check')
  Invoke-NpmStep -Name 'Frontend test' -WorkingDirectory $frontend -Arguments @('test')
  Invoke-NpmStep -Name 'Backend typecheck' -WorkingDirectory $backend -Arguments @('run', 'typecheck')
  Invoke-NpmStep -Name 'Backend lint' -WorkingDirectory $backend -Arguments @('run', 'lint')
  Invoke-NpmStep -Name 'Backend architecture check' -WorkingDirectory $backend -Arguments @('run', 'arch:check')
  Invoke-NpmStep -Name 'Backend test' -WorkingDirectory $backend -Arguments @('test')

  Write-Host ''
  Write-Host 'Quality gate passed.' -ForegroundColor Green
}
catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
