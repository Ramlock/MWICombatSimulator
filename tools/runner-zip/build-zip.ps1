# Builds the what-if runner zip from one commit of this repo. Docs: docs/codebase/runner-zip.md.
# Usage: powershell -File tools\runner-zip\build-zip.ps1 [-Commit <ref, default HEAD>] [-Out <zip path, default .\WhatIfRunner.zip>] [-Cache <folder for the downloaded node.exe>]
# Needs: git, tar.exe (Windows 10+), npm (to fetch heap-js from the lock file), and network the first time (node.exe, heap-js).
param(
    [string]$Commit = 'HEAD',
    [string]$Out = (Join-Path (Get-Location) 'WhatIfRunner.zip'),
    [string]$Cache = (Join-Path ([IO.Path]::GetTempPath()) 'whatif-runner-cache')
)
$ErrorActionPreference = 'Stop'

# The Node this zip carries: one version, fetched from nodejs.org, checked against a pinned SHA-256.
# The pin is the "win-x64/node.exe" line of https://nodejs.org/dist/v<version>/SHASUMS256.txt: to bump the version,
# change both values from that file and rebuild.
$NodeVersion = '24.15.0'
$NodeSha256 = '3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5'
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/win-x64/node.exe"

$repo = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$sha = (git -C $repo rev-parse --verify "$Commit^{commit}").Trim()
$short = (git -C $repo rev-parse --short $sha).Trim()

# node.exe: cached by version, verified every run.
New-Item -ItemType Directory -Force $Cache | Out-Null
$node = Join-Path $Cache "node-v$NodeVersion-win-x64.exe"
if (-not (Test-Path $node)) { Invoke-WebRequest -Uri $NodeUrl -OutFile $node -UseBasicParsing }
$got = (Get-FileHash -Algorithm SHA256 $node).Hash.ToLower()
if ($got -ne $NodeSha256) { Remove-Item -LiteralPath $node -Force; throw "node.exe SHA-256 is $got, expected $NodeSha256 (the cached file was removed)" }

$stage = Join-Path ([IO.Path]::GetTempPath()) ('whatif-runner-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$root = Join-Path $stage 'WhatIfRunner'
New-Item -ItemType Directory -Force $root | Out-Null
try {
    # The committed files only (never the working tree): the engine, the what-if code, the page, the launcher.
    $tar = Join-Path $stage 'tree.tar'
    git -C $repo archive --format=tar -o $tar $sha src/combatsimulator src/whatif src/marketplace.mjs src/importGuildBuffs.js src/guildLevels.mjs tools/whatif tools/calibration dist tools/runner-zip/start-runner.cmd package.json package-lock.json
    if ($LASTEXITCODE -ne 0) { throw "git archive failed ($LASTEXITCODE)" }
    tar.exe -x -f $tar -C $root
    if ($LASTEXITCODE -ne 0) { throw "tar extract failed ($LASTEXITCODE)" }
    Remove-Item -LiteralPath $tar -Force
    Get-ChildItem -LiteralPath (Join-Path $root 'dist') -Recurse -Filter *.map | Remove-Item -Force
    # git archive writes the blob as committed (LF); a batch file is written with CRLF.
    $cmdText = [IO.File]::ReadAllText((Join-Path $root 'tools\runner-zip\start-runner.cmd')) -replace "`r?`n", "`r`n"
    [IO.File]::WriteAllText((Join-Path $root 'start-runner.cmd'), $cmdText, (New-Object Text.UTF8Encoding($false)))
    Remove-Item -LiteralPath (Join-Path $root 'tools\runner-zip') -Recurse -Force

    # heap-js, the engine's one runtime dependency, exactly as package-lock.json pins it.
    $npm = Join-Path $stage 'npm'
    New-Item -ItemType Directory $npm | Out-Null
    Move-Item (Join-Path $root 'package.json') $npm
    Move-Item (Join-Path $root 'package-lock.json') $npm
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix $npm
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" }
    New-Item -ItemType Directory (Join-Path $root 'node_modules') | Out-Null
    Copy-Item -Recurse (Join-Path $npm 'node_modules\heap-js') (Join-Path $root 'node_modules\heap-js')

    Copy-Item $node (Join-Path $root 'node.exe')
    "node v$NodeVersion; commit $short" | Set-Content (Join-Path $root 'VERSION.txt')

    $outFull = [IO.Path]::GetFullPath($Out)
    if (Test-Path $outFull) { Remove-Item -LiteralPath $outFull -Force }
    tar.exe -a -c -f $outFull -C $stage WhatIfRunner
    if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" }
    '{0}: {1} MB (commit {2}, node v{3})' -f $outFull, [math]::Round((Get-Item $outFull).Length / 1MB, 1), $short, $NodeVersion
}
finally {
    if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
