param(
    [switch]$Run,
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if ($Run) {
    if (-not $ConfigPath) { throw 'ConfigPath is required.' }
    $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.identifier -notlike 'com.todocalendar.dev.review-*') {
        throw 'Review runs require an isolated identifier.'
    }
    & npx.cmd --yes '@tauri-apps/cli@2.11.4' dev --config $ConfigPath --no-watch
    exit $LASTEXITCODE
}

$sessionId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$identifier = "com.todocalendar.dev.review-$sessionId"
$sessionDir = Join-Path ([IO.Path]::GetTempPath()) "todocal-review-$sessionId"
New-Item -ItemType Directory -Path $sessionDir | Out-Null
$base = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$windows = $base.app.windows
$windows[0].title = 'TodoCalendar Dev - 修复验证版'
$override = @{
    productName = 'TodoCalendar Dev'
    identifier = $identifier
    app = @{ windows = $windows }
}
$configFile = Join-Path $sessionDir 'tauri.review.conf.json'
[IO.File]::WriteAllText($configFile, ($override | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
$stdout = Join-Path $sessionDir 'stdout.log'
$stderr = Join-Path $sessionDir 'stderr.log'
$argsLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Run -ConfigPath "{1}"' -f $PSCommandPath, $configFile
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argsLine -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$details = [ordered]@{
    identifier = $identifier
    dataDirectory = Join-Path ([Environment]::GetFolderPath('ApplicationData')) $identifier
    launcherPid = $process.Id
    config = $configFile
    stdout = $stdout
    stderr = $stderr
}
$json = $details | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $sessionDir 'session.json'), $json, [Text.UTF8Encoding]::new($false))
$json
