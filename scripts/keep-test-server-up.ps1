<#
    Keeps the client's test server reachable.

    Two things have to be alive for the phone app to work: the API on port 4000, and the
    Cloudflare tunnel that gives it a public address. Both died once already, silently, and the
    first anyone knew of it was the app saying "cannot reach the server".

    This checks every 20 seconds and restarts whichever one has gone. It also writes the current
    public URL to scripts/CURRENT-TEST-URL.txt, because a quick tunnel gets a new name every time
    it restarts -- if the file changes, the client has to be told the new address (Settings ->
    Change server address, on his phone).

    Run it in its own PowerShell window and leave it there:

        powershell -ExecutionPolicy Bypass -File "D:\shridhar project\scripts\keep-test-server-up.ps1"

    Stop it with Ctrl+C. This is for client testing only; the AWS deployment needs none of it.
#>

$ErrorActionPreference = 'Continue'

$root      = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $root 'server'
$logDir    = Join-Path $root '.testserver'
$urlFile   = Join-Path $PSScriptRoot 'CURRENT-TEST-URL.txt'
$cf        = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Api {
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:4000/api/health' -UseBasicParsing -TimeoutSec 5
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Start-Api {
    Write-Host "[$(Get-Date -Format HH:mm:ss)] starting API on 4000"
    # A fresh pair of log files each time. Reusing one name fails outright when the previous
    # node process still holds the handle, and Start-Process reports that as a red error nobody
    # is watching for.
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    try {
        Start-Process -FilePath 'node' -ArgumentList 'dist/index.js' `
            -WorkingDirectory $serverDir `
            -RedirectStandardOutput (Join-Path $logDir "server-$stamp.out.log") `
            -RedirectStandardError  (Join-Path $logDir "server-$stamp.err.log") `
            -WindowStyle Hidden
    } catch {
        Write-Host "[$(Get-Date -Format HH:mm:ss)] could not start the API: $_" -ForegroundColor Red
    }
    Start-Sleep -Seconds 6
}

function Get-TunnelProcess {
    Get-Process cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1
}

<#
    Is the tunnel actually serving?

    Checking that a cloudflared process exists is not the same question, and the difference cost a
    client an evening: the process stayed up while its tunnel lost its registration, so Cloudflare
    answered every request with 530 -- "cannot reach the origin" -- and the watchdog saw a healthy
    process and did nothing. The only honest test is to ask the public URL.
#>
function Test-Tunnel {
    param([string] $Url)
    if (-not $Url) { return $false }
    try {
        $r = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 15
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Stop-Tunnel {
    Get-Process cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

<#
    Is this watchdog already running?

    Answered with a lock file holding a process id, not by searching command lines. Command-line
    matching failed twice here for the same reason: any process that merely mentions this script
    -- the shell that launched it, a tool checking on it -- carries the search text inside its own
    command line, so the search finds a stranger and reports success while nothing is watching.
    A pid either belongs to a live process or it does not.
#>
function Test-AlreadyRunning {
    param([string] $LockFile)
    if (-not (Test-Path $LockFile)) { return $false }
    $recorded = (Get-Content $LockFile -Raw -ErrorAction SilentlyContinue)
    if (-not $recorded) { return $false }
    $recorded = $recorded.Trim()
    if ($recorded -notmatch '^\d+$') { return $false }
    if ([int]$recorded -eq $PID) { return $false }
    return $null -ne (Get-Process -Id ([int]$recorded) -ErrorAction SilentlyContinue)
}

function Start-Tunnel {
    Write-Host "[$(Get-Date -Format HH:mm:ss)] starting tunnel"
    $out = Join-Path $logDir 'tunnel-out.log'
    $err = Join-Path $logDir 'tunnel-err.log'
    Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath $cf `
        -ArgumentList 'tunnel --url http://localhost:4000 --no-autoupdate' `
        -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden

    foreach ($i in 1..40) {
        Start-Sleep -Seconds 3
        $txt = (Get-Content $err, $out -ErrorAction SilentlyContinue) -join "`n"
        $m = [regex]::Match($txt, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($m.Success) {
            $url = $m.Value
            $previous = if (Test-Path $urlFile) { (Get-Content $urlFile -Raw).Trim() } else { '' }
            # WriteAllText, not Set-Content: PowerShell's utf8 writes a byte-order mark, and the
            # first thing to read this file pasted an invisible character into a URL.
            [System.IO.File]::WriteAllText($urlFile, $url)
            if ($previous -and $previous -ne $url) {
                Write-Host ''
                Write-Host '  !! THE PUBLIC ADDRESS CHANGED !!' -ForegroundColor Yellow
                Write-Host "  was: $previous"
                Write-Host "  now: $url"
                Write-Host '  Tell the client: Settings -> Change server address, then enter the new one.' -ForegroundColor Yellow
                Write-Host ''
            } else {
                Write-Host "[$(Get-Date -Format HH:mm:ss)] tunnel up: $url"
            }
            return
        }
    }
    Write-Host "[$(Get-Date -Format HH:mm:ss)] tunnel did not report a URL; will retry" -ForegroundColor Red
}

$lock = Join-Path $logDir 'watchdog.pid'
if (Test-AlreadyRunning -LockFile $lock) {
    Write-Host 'Another watchdog is already running. Nothing to do.' -ForegroundColor Yellow
    exit 0
}
Set-Content -Path $lock -Value $PID -Encoding utf8

Write-Host 'Keeping the test server up. Leave this window open. Ctrl+C to stop.'
Write-Host ''

# A heartbeat on disk, so "is it running?" can be answered by looking rather than by guessing at
# process lists.
$beat = Join-Path $logDir 'watchdog-heartbeat.txt'

# The public URL is only probed every third pass. Once a minute is often enough to catch a dead
# tunnel, and it keeps the round trip off Cloudflare's doorstep the rest of the time.
$pass = 0

while ($true) {
    $pass++
    if (-not (Test-Api)) { Start-Api }

    $url = if (Test-Path $urlFile) { (Get-Content $urlFile -Raw).Trim() } else { '' }

    if (-not (Get-TunnelProcess)) {
        Start-Tunnel
    } elseif ($pass % 3 -eq 0 -and -not (Test-Tunnel $url)) {
        Write-Host "[$(Get-Date -Format HH:mm:ss)] the tunnel stopped serving; restarting it" -ForegroundColor Yellow
        Stop-Tunnel
        Start-Tunnel
    }

    Set-Content -Path $beat -Value "alive $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') pid $PID" -Encoding utf8
    Start-Sleep -Seconds 20
}
