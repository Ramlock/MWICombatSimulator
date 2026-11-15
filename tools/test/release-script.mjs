// Test: tools/release/release.ps1, the release script, with no network and no real build. Its seam (MWI_RELEASE_SEAM, a .ps1
// dot-sourced after its own functions) replaces every outward and heavy function by a fake that logs its call to a file, keeps the
// remote's state (release, assets, main) in a JSON file, and throws when its call matches FAKE_FAIL. Cases: (1) a full run does
// steps 1 to 11 in order, and the outward calls come after the built-file tests, in the order release, uploads, push; (2) a failure
// at each of steps 1 to 10 stops there: exit 1, nothing of the later steps called, the DONE / NOT DONE lists split at that step;
// (3) a second run with the same commit after a failed push skips the build, the tests, the release and the uploads, and pushes;
// a third run pushes nothing; (4) -DryRun makes no outward call and logs steps 4, 5 and 8 as skipped.
// Usage: node tools/test/release-script.mjs. Needs Windows PowerShell. Exit code 0 on pass, 1 on fail.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'tools', 'release', 'release.ps1');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'release-script-'));
let fails = 0;
const check = (ok, what, extra = '') => { if (!ok) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };

const fake = path.join(work, 'fake.ps1');
fs.writeFileSync(fake, String.raw`
function Fake-Call([string]$Line) {
    Add-Content -LiteralPath $env:FAKE_LOG -Value $Line
    if ($env:FAKE_FAIL -and $Line -match $env:FAKE_FAIL) { throw "fake failure: $Line" }
}
function Fake-State { Get-Content -Raw $env:FAKE_STATE | ConvertFrom-Json }
function Save-State($s) { [IO.File]::WriteAllText($env:FAKE_STATE, ($s | ConvertTo-Json -Depth 5)) }
function Test-CommitOnRemote([string]$Sha) { Fake-Call "Test-CommitOnRemote $Sha"; $true }
function Test-MainAncestor([string]$Sha) { Fake-Call "Test-MainAncestor $Sha"; $true }
function Get-WorktreeState { Fake-Call 'Get-WorktreeState'; @{ Head = $Commit; Clean = $true } }
function Build-Runner([string]$Sha, [string]$Exe, [string]$Zip) { Fake-Call "Build-Runner $Exe"; Set-Content $Exe 'exe'; Set-Content $Zip 'zipzip' }
function Test-RunnerExe([string]$Exe, [string]$Short) { Fake-Call "Test-RunnerExe $Exe" }
function Test-RunnerZip([string]$Zip) { Fake-Call "Test-RunnerZip $Zip" }
function Get-Release([string]$Tag) { Fake-Call "Get-Release $Tag"; (Fake-State).release }
function New-Release([string]$Tag, [string]$Sha) { Fake-Call "New-Release $Tag"; $s = Fake-State; $s.release = @{ id = 5 }; Save-State $s; $s.release }
function Get-Assets($Id) { Fake-Call "Get-Assets $Id"; @((Fake-State).assets) }
function Remove-Asset($AssetId) { Fake-Call "Remove-Asset $AssetId" }
function Send-Asset($Id, [string]$File, [string]$Name) { Fake-Call "Send-Asset $Name"; $s = Fake-State; $s.assets = @(@($s.assets) + @{ id = 9; name = $Name; size = (Get-Item $File).Length }); Save-State $s }
function Get-LatestRedirect([string]$Name) { Fake-Call "Get-LatestRedirect $Name"; "https://github.com/x/releases/download/$($R.Tag)/$Name" }
function Get-Download([string]$Name, [string]$Out) { Fake-Call "Get-Download $Name"; Copy-Item (Join-Path $R.Out $Name) $Out }
function Get-RemoteMain { Fake-Call 'Get-RemoteMain'; (Fake-State).main }
function Push-Main([string]$Sha) { Fake-Call "Push-Main $Sha"; $s = Fake-State; $s.main = $Sha; Save-State $s }
function Get-PagesRun([string]$Sha) { Fake-Call "Get-PagesRun $Sha"; @{ id = 7; status = 'completed'; conclusion = 'success'; run_attempt = 1 } }
function Test-ZeroArtifactFailure($Run) { Fake-Call 'Test-ZeroArtifactFailure'; $false }
function Start-Rerun($RunId) { Fake-Call "Start-Rerun $RunId" }
function Get-LiveBundle([string]$Url) { Fake-Call "Get-LiveBundle $Url"; 'bundle.abcdef12.js' }
function Get-CommitBundle([string]$Sha) { 'bundle.abcdef12.js' }
function Wait-Seconds([int]$N) { }
`);

const OUTWARD = /^(New-Release|Send-Asset|Remove-Asset|Push-Main|Start-Rerun)\b/;
const STEPS = ['checks', 'build', 'test built files', 'create release', 'upload assets', 'check download', 'test downloaded exe', 'push main', 'pages run', 'live page', 'result'];
const commits = [];
const newCommit = () => { const c = crypto.randomBytes(20).toString('hex'); commits.push(c); return c; };
function run(commit, { fail = '', dry = false, fresh = false } = {}) {
    const state = path.join(work, commit + '.json'), log = path.join(work, commit + '.log');
    if (fresh || !fs.existsSync(state)) fs.writeFileSync(state, JSON.stringify({ release: null, assets: [], main: 'old' }));
    fs.writeFileSync(log, '');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Commit', commit, ...(dry ? ['-DryRun'] : [])];
    const r = spawnSync('powershell.exe', args, { env: { ...process.env, MWI_RELEASE_SEAM: fake, FAKE_LOG: log, FAKE_STATE: state, FAKE_FAIL: fail }, encoding: 'utf8', windowsHide: true });
    const out = r.stdout + r.stderr;
    return { code: r.status, out, calls: fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean), steps: [...out.matchAll(/STEP (\d+) /g)].map((m) => Number(m[1])) };
}
const idx = (calls, re) => calls.findIndex((c) => re.test(c));

try {
    // (1) Full run.
    const c1 = newCommit(), r1 = run(c1);
    check(r1.code === 0 && r1.steps.join() === '1,2,3,4,5,6,7,8,9,10,11', '1: a full run does steps 1 to 11 in order', r1.out);
    const iTest = idx(r1.calls, /^Test-RunnerZip/), iRel = idx(r1.calls, /^New-Release/), iUp = idx(r1.calls, /^Send-Asset/), iPush = idx(r1.calls, /^Push-Main/);
    check(iTest >= 0 && iTest < iRel && iRel < iUp && iUp < iPush, '1: built files tested, then release, uploads, push', r1.calls.join(' | '));
    check(r1.calls.filter((c) => /^Send-Asset/.test(c)).length === 2 && /RESULT/.test(r1.out) && /release: id 5, tag runner-/.test(r1.out), '1: two uploads and the result block');

    // (2) A failure at each step stops there.
    const failAt = { 1: '^Test-CommitOnRemote', 2: '^Build-Runner', 3: '^Test-RunnerExe .*mwi-release-[0-9a-f]{7}\\\\', 4: '^New-Release', 5: '^Send-Asset',
        6: '^Get-Download', 7: '^Test-RunnerExe .*mwi-release-[0-9a-f]{8}\\\\', 8: '^Push-Main', 9: '^Get-PagesRun', 10: '^Get-LiveBundle' };
    for (const [k, re] of Object.entries(failAt)) {
        const n = Number(k), r = run(newCommit(), { fail: re });
        const done = STEPS.slice(0, n - 1).map((s, i) => `${i + 1} ${s}`).join('; '), notDone = STEPS.slice(n - 1).map((s, i) => `${i + n} ${s}`).join('; ');
        const later = { 3: /^New-Release/, 4: /^Send-Asset/, 5: /^Get-Download/, 7: /^Push-Main/, 8: /^Get-PagesRun/, 9: /^Get-LiveBundle/ }[n];
        check(r.code === 1 && Math.max(...r.steps) === n && r.out.includes(`FAILED step ${n} ${STEPS[n - 1]}`) && r.out.includes(`DONE:     ${done}\n`.trimEnd()) && r.out.includes(`NOT DONE: ${notDone}`)
            && (!later || idx(r.calls, later) < 0), `2: a failure at step ${n} stops there, with the right done / not done lists`, r.out);
    }

    // (3) A second run after a failed push carries on; a third does nothing outward.
    const c3 = newCommit();
    const a = run(c3, { fail: '^Push-Main' }), b = run(c3), c = run(c3);
    check(a.code === 1 && b.code === 0 && !b.calls.some((x) => /^(Build-Runner|Test-RunnerZip|New-Release|Send-Asset)/.test(x)) && b.calls.filter((x) => /^Push-Main/.test(x)).length === 1,
        '3: the second run skips build, tests, release and uploads, and pushes', b.calls.join(' | '));
    check(c.code === 0 && !c.calls.some((x) => OUTWARD.test(x)) && /main is already at the commit: kept/.test(c.out), '3: a third run makes no outward call', c.calls.join(' | '));

    // (4) Dry run.
    const d = run(newCommit(), { dry: true });
    check(d.code === 0 && !d.calls.some((x) => OUTWARD.test(x)), '4: -DryRun makes no outward call', d.calls.join(' | '));
    const stepText = (n) => d.out.split(/STEP /).find((s) => s.startsWith(`${n} `)) || '';
    check([4, 5, 8].every((n) => /SKIPPED \(dry run\)/.test(stepText(n))) && /RESULT \(dry run\)/.test(d.out) && idx(d.calls, /^Build-Runner/) >= 0 && idx(d.calls, /^Test-RunnerExe/) >= 0,
        '4: -DryRun builds and tests, and logs steps 4, 5 and 8 as skipped', d.out);
} finally {
    for (const c of commits) fs.rmSync(path.join(os.tmpdir(), 'mwi-release-' + c.slice(0, 7)), { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
