# Builds WhatIfRunner.exe, the one-file what-if runner for Windows, from one commit of this repo. Docs: docs/codebase/runner-zip.md.
# Usage: powershell -File tools\runner-zip\build-exe.ps1 [-Commit <ref, default HEAD>] [-Out <exe path, default .\WhatIfRunner.exe>] [-Cache <folder for the downloaded node.exe>] [-Zip <path: also keep the zip it was built from, for Linux>]
# Needs what build-zip.ps1 needs, plus npx (postject, pinned below) and network the first time.
# The exe is the zip's files and the zip's node.exe (Node single executable application): build-zip.ps1 makes the zip from the
# commit, this script embeds its files (all but node.exe and start-runner.cmd) and the commit's exe-entry.cjs into that node.exe.
param(
    [string]$Commit = 'HEAD',
    [string]$Out = (Join-Path (Get-Location) 'WhatIfRunner.exe'),
    [string]$Cache = (Join-Path ([IO.Path]::GetTempPath()) 'whatif-runner-cache'),
    [string]$Zip = ''
)
$ErrorActionPreference = 'Stop'

$Postject = 'postject@1.0.0-alpha.6'
# The fuse every Node build carries; postject flips it so the exe runs the embedded blob (Node's SEA docs).
$Fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

$repo = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$sha = (git -C $repo rev-parse --verify "$Commit^{commit}").Trim()
$short = (git -C $repo rev-parse --short $sha).Trim()

$stage = Join-Path ([IO.Path]::GetTempPath()) ('whatif-runner-exe-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $stage | Out-Null
try {
    $stageZip = Join-Path $stage 'WhatIfRunner.zip'
    & (Join-Path $PSScriptRoot 'build-zip.ps1') -Commit $sha -Out $stageZip -Cache $Cache | Out-Null
    if ($Zip) { Copy-Item $stageZip ([IO.Path]::GetFullPath($Zip)) -Force }
    tar.exe -x -f $stageZip -C $stage
    if ($LASTEXITCODE -ne 0) { throw "tar extract failed ($LASTEXITCODE)" }
    $root = Join-Path $stage 'WhatIfRunner'
    $node = Join-Path $root 'node.exe'

    $entry = Join-Path $stage 'entry.cjs'
    $entryText = git -C $repo show "${sha}:tools/runner-zip/exe-entry.cjs"
    if ($LASTEXITCODE -ne 0) { throw "commit $short has no tools/runner-zip/exe-entry.cjs" }
    [IO.File]::WriteAllText($entry, ($entryText -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))

    # The embedded files, keyed by their path in the zip's folder; the build id is a hash of all of them and the entry, so the
    # unpack folder changes exactly when what is unpacked (or how) changes.
    $assets = [ordered]@{}
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $ids = New-Object System.Collections.Generic.List[string]
    $rootFull = (Get-Item $root).FullName.TrimEnd('\') + '\'
    foreach ($f in Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName) {
        $rel = $f.FullName.Substring($rootFull.Length).Replace('\', '/')
        if ($rel -eq 'node.exe' -or $rel -eq 'start-runner.cmd') { continue }
        $assets[$rel] = $f.FullName
        $ids.Add($rel + ' ' + (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash)
    }
    $ids.Add('entry ' + (Get-FileHash -Algorithm SHA256 -LiteralPath $entry).Hash)
    $buildId = (-join ($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes(($ids -join "`n"))) | ForEach-Object { $_.ToString('x2') })).Substring(0, 12)
    $idFile = Join-Path $stage 'build-id.txt'
    [IO.File]::WriteAllText($idFile, $buildId)
    $assets['build-id'] = $idFile

    $blob = Join-Path $stage 'sea-prep.blob'
    $config = Join-Path $stage 'sea-config.json'
    $cfg = [ordered]@{ main = $entry; output = $blob; disableExperimentalSEAWarning = $true; useCodeCache = $false; useSnapshot = $false; assets = $assets }
    [IO.File]::WriteAllText($config, ($cfg | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))
    & $node --experimental-sea-config $config
    if ($LASTEXITCODE -ne 0) { throw "node --experimental-sea-config failed ($LASTEXITCODE)" }

    $outFull = [IO.Path]::GetFullPath($Out)
    New-Item -ItemType Directory -Force (Split-Path $outFull) | Out-Null
    Copy-Item $node $outFull -Force
    # postject warns "The signature seems corrupted": the injection invalidates node.exe's own signature; the exe ships unsigned.
    npx --yes $Postject $outFull NODE_SEA_BLOB $blob --sentinel-fuse $Fuse
    if ($LASTEXITCODE -ne 0) { throw "postject failed ($LASTEXITCODE)" }
    '{0}: {1} MB (commit {2}, build {3}, {4} embedded files)' -f $outFull, [math]::Round((Get-Item $outFull).Length / 1MB, 1), $short, $buildId, ($assets.Count - 1)
}
finally {
    if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
