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
    Start-Process -FilePath 'node' -ArgumentList 'dist/index.js' `
        -WorkingDirectory $serverDir `
        -RedirectStandardOutput (Join-Path $logDir 'server-out.log') `
        -RedirectStandardError  (Join-Path $logDir 'server-err.log') `
        -WindowStyle Hidden
    Start-Sleep -Seconds 6
}

function Get-TunnelProcess {
    Get-Process cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1
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
            Set-Content -Path $urlFile -Value $url -Encoding utf8
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

Write-Host 'Keeping the test server up. Leave this window open. Ctrl+C to stop.'
Write-Host ''

while ($true) {
    if (-not (Test-Api)) { Start-Api }
    if (-not (Get-TunnelProcess)) { Start-Tunnel }
    Start-Sleep -Seconds 20
}
