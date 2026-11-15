# Runs the fixed steps of a runner release of the fork for one commit: checks, builds the exe and the zip, tests both by a real
# search, makes the release runner-<short sha> (latest) with both as assets, checks the download, pushes the commit to main, waits
# for the Pages run, checks the live page. Docs: docs/codebase/release-script.md.
# Usage: powershell -File tools\release\release.ps1 -Commit <full sha> [-DryRun]
# The caller runs it under HeavyRun (the builds and the searches are heavy). The live pictures are not part of it: they stay by hand.
# -DryRun is the same flow: every outward call (create the release, upload or delete an asset, push main, rerun Pages) is skipped and
# logged, and the steps that only check an outward effect are skipped with it. A second run with the same commit finds what is done
# (the release with that tag, an asset of the same size, main at the commit, a successful Pages run) and skips it.
# Seam for tests: if MWI_RELEASE_SEAM names a .ps1 file, it is dot-sourced after the functions below, and may replace any of them.
param(
    [Parameter(Mandatory = $true)][string]$Commit,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$Repo = 'Ramlock/MWICombatSimulator'
$Site = @('https://ramlock.github.io/MWICombatSimulator/', 'https://ramlock.github.io/MWICombatSimulator/dist/')
$Names = @('WhatIfRunner.exe', 'WhatIfRunner.zip')
$Root = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$env:Path = 'C:\Windows\System32;' + $env:Path
$env:BROWSER = 'C:\Windows\System32\where.exe'   # a no-op: any runner started below never opens a browser

function Write-Log([string]$m) { Write-Host ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }

# ---- The functions every outside effect goes through (the test seam replaces them). ----
function Get-Token { (gh auth token --user Ramlock).Trim() }
function Invoke-Api([string]$Method, [string]$Path, $Body = $null) {
    # Returns the parsed JSON, or $null on 404.
    $tok = Get-Token
    $a = @('api', '-X', $Method, "repos/$Repo/$Path", '-H', "Authorization: token $tok")
    $in = $null
    if ($null -ne $Body) { $in = [IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($in, ($Body | ConvertTo-Json -Depth 5)); $a += @('--input', $in) }
    try {
        $out = & gh @a 2>&1
        if ($LASTEXITCODE -ne 0) { if ("$out" -match 'HTTP 404') { return $null }; throw "gh api $Method $Path failed: $out" }
        $text = ($out | Out-String).Trim()
        if (-not $text) { return @{} }
        if ($text.StartsWith('{') -or $text.StartsWith('[')) { return ($text | ConvertFrom-Json) }
        return $text
    } finally { if ($in) { Remove-Item $in -Force } }
}
function Test-CommitOnRemote([string]$Sha) {
    git -C $Root fetch -q origin; if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    return [bool](git -C $Root branch -r --contains $Sha 2>$null | Where-Object { $_ -match 'origin/' })
}
function Test-MainAncestor([string]$Sha) { git -C $Root merge-base --is-ancestor origin/main $Sha; return $LASTEXITCODE -eq 0 }
function Get-WorktreeState { @{ Head = (git -C $Root rev-parse HEAD).Trim(); Clean = -not (git -C $Root status --porcelain --untracked-files=no) } }
function Build-Runner([string]$Sha, [string]$Exe, [string]$Zip) {
    & (Join-Path $Root 'tools\runner-zip\build-exe.ps1') -Commit $Sha -Out $Exe -Zip $Zip | ForEach-Object { Write-Log "  $_" }
}
function Test-RunnerExe([string]$Exe, [string]$Short) {
    node (Join-Path $Root 'tools\test\whatif-runner-exe.mjs') --exe $Exe --commit $Short | ForEach-Object { Write-Log "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "whatif-runner-exe failed on $Exe" }
}
function Test-RunnerZip([string]$Zip) {
    $d = New-TempDir
    try {
        tar.exe -x -f $Zip -C $d; if ($LASTEXITCODE -ne 0) { throw 'tar extract failed' }
        node (Join-Path $Root 'tools\release\zip-search.mjs') --dir (Join-Path $d 'WhatIfRunner') | ForEach-Object { Write-Log "  $_" }
        if ($LASTEXITCODE -ne 0) { throw "the search from $Zip failed" }
    } finally { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
}
function Get-Release([string]$Tag) { Invoke-Api GET "releases/tags/$Tag" }
function New-Release([string]$Tag, [string]$Sha) { Invoke-Api POST 'releases' @{ tag_name = $Tag; target_commitish = $Sha; name = $Tag; make_latest = 'true' } }
function Get-Assets($Id) { @(Invoke-Api GET "releases/$Id/assets") }
function Remove-Asset($AssetId) { Invoke-Api DELETE "releases/assets/$AssetId" | Out-Null }
function Send-Asset($Id, [string]$File, [string]$Name) {
    $h = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($h, "Authorization: token $(Get-Token)`nContent-Type: application/octet-stream`n")
        $code = curl.exe -s -o NUL -w '%{http_code}' -X POST -H "@$h" --data-binary "@$File" "https://uploads.github.com/repos/$Repo/releases/$Id/assets?name=$Name"
        if ($code -ne '201') { throw "upload of $Name answered HTTP $code" }
    } finally { Remove-Item $h -Force }
}
function Get-LatestRedirect([string]$Name) { curl.exe -s -o NUL -w '%{redirect_url}' "https://github.com/$Repo/releases/latest/download/$Name" }
function Get-Download([string]$Name, [string]$Out) {
    curl.exe -s -f -L -o $Out "https://github.com/$Repo/releases/latest/download/$Name"; if ($LASTEXITCODE -ne 0) { throw "download of $Name failed" }
}
function Get-RemoteMain { ((git -C $Root ls-remote origin refs/heads/main) -split '\s+')[0] }
function Push-Main([string]$Sha) { git -C $Root push origin "${Sha}:refs/heads/main"; if ($LASTEXITCODE -ne 0) { throw 'push to main failed (not a fast-forward?)' } }
function Get-PagesRun([string]$Sha) {
    $r = Invoke-Api GET "actions/workflows/pages.yml/runs?head_sha=$Sha&event=push&per_page=5"
    if ($r -and $r.workflow_runs) { return @($r.workflow_runs)[0] }
}
function Test-ZeroArtifactFailure($Run) {
    foreach ($j in @((Invoke-Api GET "actions/runs/$($Run.id)/jobs").jobs)) {
        $log = Invoke-Api GET "actions/jobs/$($j.id)/logs"
        if ("$log" -match 'Found 0 artifact\(s\)') { return $true }
    }
    return $false
}
function Start-Rerun($RunId) { Invoke-Api POST "actions/runs/$RunId/rerun" | Out-Null }
function Get-LiveBundle([string]$Url) {
    $t = (Invoke-WebRequest -UseBasicParsing -Uri ($Url + '?nocache=' + [guid]::NewGuid().ToString('N'))).Content
    if ($t -match 'bundle\.[0-9a-f]{8}\.js') { return $Matches[0] }
}
function Get-CommitBundle([string]$Sha) {
    $t = (git -C $Root show "${Sha}:dist/index.html") -join "`n"
    if ($t -match 'bundle\.[0-9a-f]{8}\.js') { return $Matches[0] }
}
function Wait-Seconds([int]$N) { Start-Sleep -Seconds $N }
function New-TempDir { $d = Join-Path ([IO.Path]::GetTempPath()) ('mwi-release-' + [guid]::NewGuid().ToString('N').Substring(0, 8)); New-Item -ItemType Directory $d | Out-Null; $d }

if ($env:MWI_RELEASE_SEAM) { . $env:MWI_RELEASE_SEAM }

# ---- The flow. ----
$StepNames = @('checks', 'build', 'test built files', 'create release', 'upload assets', 'check download', 'test downloaded exe',
    'push main', 'pages run', 'live page', 'result')
$Done = New-Object System.Collections.Generic.List[string]
$Times = [ordered]@{}
$R = @{}
function Skip-Outward([string]$What) { Write-Log "  SKIPPED (dry run): $What" }
function Invoke-Outward([string]$What, [scriptblock]$Do) { if ($DryRun) { Skip-Outward $What } else { Write-Log "  $What"; & $Do } }

$steps = @(
    { # 1
        if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "-Commit must be a full 40-character sha, got '$Commit'" }
        if (-not (Test-CommitOnRemote $Commit)) { throw "commit $Commit is on no remote branch" }
        if (-not (Test-MainAncestor $Commit)) { throw "origin/main is not an ancestor of $Commit (not a fast-forward)" }
        $w = Get-WorktreeState
        if ($w.Head -ne $Commit) { throw "this worktree is at $($w.Head), not $Commit" }
        if (-not $w.Clean) { throw 'this worktree has uncommitted changes' }
    },
    { # 2
        if ((Test-Path $R.Exe) -and (Test-Path $R.Zip) -and (Test-Path $R.BuiltMark)) { Write-Log "  already built in $($R.Out): kept"; return }
        Remove-Item -LiteralPath $R.BuiltMark, $R.TestedMark -Force -ErrorAction SilentlyContinue
        Build-Runner $Commit $R.Exe $R.Zip
        if (-not ((Test-Path $R.Exe) -and (Test-Path $R.Zip))) { throw 'the build made no exe or no zip' }
        New-Item -ItemType File -Force $R.BuiltMark | Out-Null
    },
    { # 3
        if (Test-Path $R.TestedMark) { Write-Log '  already tested: kept'; return }
        Test-RunnerExe $R.Exe $R.Short
        Test-RunnerZip $R.Zip
        New-Item -ItemType File -Force $R.TestedMark | Out-Null
    },
    { # 4
        $rel = Get-Release $R.Tag
        if ($rel) { Write-Log "  release $($R.Tag) exists (id $($rel.id)): kept"; $R.ReleaseId = $rel.id; return }
        Invoke-Outward "create release $($R.Tag), latest" { $script:R.ReleaseId = (New-Release $R.Tag $Commit).id }
    },
    { # 5
        if (-not $R.ReleaseId) { Skip-Outward 'upload both assets (no release)'; return }
        $assets = Get-Assets $R.ReleaseId
        foreach ($n in $Names) {
            $f = Join-Path $R.Out $n; $size = (Get-Item $f).Length
            $a = $assets | Where-Object { $_.name -eq $n }
            if ($a -and [long]$a.size -eq $size) { Write-Log "  asset $n ($size bytes) exists: kept"; continue }
            if ($a) { Invoke-Outward "delete asset $n of another size ($($a.size) bytes)" { Remove-Asset $a.id } }
            Invoke-Outward "upload $n ($size bytes)" { Send-Asset $R.ReleaseId $f $n }
        }
    },
    { # 6
        if ($DryRun) { Skip-Outward 'check the download (needs the release)'; return }
        foreach ($n in $Names) {
            $t0 = Get-Date
            while ((Get-LatestRedirect $n) -notmatch "/download/$([regex]::Escape($R.Tag))/") {
                if (((Get-Date) - $t0).TotalSeconds -gt 600) { throw "releases/latest/download/$n still does not redirect to $($R.Tag) after 10 minutes" }
                Wait-Seconds 15
            }
            $d = Join-Path $R.Dl $n
            Get-Download $n $d
            if ((Get-FileHash $d).Hash -ne (Get-FileHash (Join-Path $R.Out $n)).Hash) { throw "the downloaded $n differs from the local build" }
            Write-Log "  ${n}: redirect names $($R.Tag), download equals the local build"
        }
    },
    { # 7
        if ($DryRun) { Skip-Outward 'test the downloaded exe (needs the release)'; return }
        Test-RunnerExe (Join-Path $R.Dl 'WhatIfRunner.exe') $R.Short
    },
    { # 8
        if ((Get-RemoteMain) -eq $Commit) { Write-Log '  main is already at the commit: kept'; return }
        Invoke-Outward "push $Commit to main (fast-forward)" { Push-Main $Commit }
    },
    { # 9
        if ($DryRun) { Skip-Outward 'wait for the Pages run (needs the push)'; return }
        $t0 = Get-Date; $rerun = $false
        while ($true) {
            $run = Get-PagesRun $Commit
            if ($run -and $run.status -eq 'completed') {
                if ($run.conclusion -eq 'success') { Write-Log "  Pages run $($run.id) succeeded"; $R.PagesRun = $run.id; return }
                if (-not $rerun -and [int]$run.run_attempt -eq 1 -and (Test-ZeroArtifactFailure $run)) {
                    Invoke-Outward "rerun the whole Pages run $($run.id) (Found 0 artifact(s))" { Start-Rerun $run.id }; $rerun = $true
                } else { throw "Pages run $($run.id) ended $($run.conclusion)" }
            }
            if (((Get-Date) - $t0).TotalSeconds -gt 1800) { throw 'no successful Pages run of the commit after 30 minutes' }
            Wait-Seconds 20
        }
    },
    { # 10
        if ($DryRun) { Skip-Outward 'check the live page (needs the push)'; return }
        $want = Get-CommitBundle $Commit
        if (-not $want) { throw 'the commit''s dist/index.html names no bundle' }
        foreach ($u in $Site) {
            $t0 = Get-Date
            while (($got = Get-LiveBundle $u) -ne $want) {
                if (((Get-Date) - $t0).TotalSeconds -gt 900) { throw "$u names $got, not $want, after 15 minutes" }
                Wait-Seconds 30
            }
            Write-Log "  $u names $want"
        }
        $R.Bundle = $want
    },
    { # 11
        $sizes = ($Names | ForEach-Object { '{0} {1} bytes' -f $_, (Get-Item (Join-Path $R.Out $_)).Length }) -join ', '
        $lines = @('RESULT' + $(if ($DryRun) { ' (dry run)' } else { '' }), "  commit:  $Commit", "  release: $(if ($R.ReleaseId) { "id $($R.ReleaseId), " })tag $($R.Tag)",
            "  assets:  $sizes", "  live:    $(if ($R.Bundle) { $R.Bundle } else { '(not checked)' })")
        foreach ($k in $Times.Keys) { $lines += ('  step {0}' -f $k) + ': ' + $Times[$k] }
        $lines | ForEach-Object { Write-Log $_ }
    }
)

$R.Short = $Commit.Substring(0, [Math]::Min(7, $Commit.Length))
$R.Tag = "runner-$($R.Short)"
$R.Out = Join-Path ([IO.Path]::GetTempPath()) "mwi-release-$($R.Short)"
New-Item -ItemType Directory -Force $R.Out | Out-Null
$R.Exe = Join-Path $R.Out 'WhatIfRunner.exe'; $R.Zip = Join-Path $R.Out 'WhatIfRunner.zip'
$R.BuiltMark = Join-Path $R.Out '.built'; $R.TestedMark = Join-Path $R.Out '.tested'
$R.Dl = New-TempDir
Write-Log "release of $Commit$(if ($DryRun) { ' (DRY RUN: no outward call)' })"
$failed = $null
try {
    for ($i = 0; $i -lt $steps.Count; $i++) {
        $label = "$($i + 1) $($StepNames[$i])"
        Write-Log "STEP $label"
        $t = [Diagnostics.Stopwatch]::StartNew()
        try { & $steps[$i] } catch { $failed = $label; Write-Log "FAILED step ${label}: $($_.Exception.Message)"; break }
        $Times[$label] = '{0:0}s' -f $t.Elapsed.TotalSeconds
        $Done.Add($label)
    }
} finally { Remove-Item -LiteralPath $R.Dl -Recurse -Force -ErrorAction SilentlyContinue }
if ($failed) {
    Write-Log ('DONE:     ' + ($Done -join '; '))
    Write-Log ('NOT DONE: ' + (($StepNames | ForEach-Object -Begin { $n = 0 } -Process { $n++; "$n $_" } | Where-Object { -not $Done.Contains($_) }) -join '; '))
    exit 1
}
exit 0
