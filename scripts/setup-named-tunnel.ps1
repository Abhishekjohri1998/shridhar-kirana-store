<#
    Give the test server an address that stops changing.

    A quick tunnel gets a new trycloudflare.com name every time it restarts, and every restart
    means telling the shopkeeper to re-enter it. A *named* tunnel keeps one hostname for good --
    but it needs a Cloudflare account and a domain in it, because the hostname has to live in a
    DNS zone somebody owns. trycloudflare.com is not such a zone; it is scratch space.

    Two things to do first, both of which need a person:

      1. A Cloudflare account with your domain added to it (Websites -> Add a site).
      2. cloudflared tunnel login
         Opens a browser, you pick the domain, and it writes ~/.cloudflared/cert.pem.

    Then run this with the hostname you want the shop to use:

      powershell -ExecutionPolicy Bypass -File "D:\shridhar project\scripts\setup-named-tunnel.ps1" -Hostname billing.yourdomain.com

    Afterwards the watchdog serves that hostname instead of a rotating one, and
    scripts/CURRENT-TEST-URL.txt stops changing.
#>

param(
    [Parameter(Mandatory = $true)]
    [string] $Hostname,

    [string] $TunnelName = 'simple-sales-book',
    [int]    $Port = 4000
)

$ErrorActionPreference = 'Stop'

$cf      = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$home_   = [Environment]::GetFolderPath('UserProfile')
$cfDir   = Join-Path $home_ '.cloudflared'
$cert    = Join-Path $cfDir 'cert.pem'
$config  = Join-Path $cfDir 'config.yml'
$urlFile = Join-Path $PSScriptRoot 'CURRENT-TEST-URL.txt'

if (-not (Test-Path $cf)) { throw "cloudflared is not installed at $cf" }

if (-not (Test-Path $cert)) {
    Write-Host ''
    Write-Host 'Not logged in to Cloudflare yet. Run this first, and pick your domain in the browser:' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '    & "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel login'
    Write-Host ''
    Write-Host 'It needs a Cloudflare account with your domain already added to it.'
    exit 1
}

# --- the tunnel itself ------------------------------------------------------
# Created once and reused. Its credentials file is what proves this machine may serve the
# hostname, so it is created here rather than checked into anything.
$existing = & $cf tunnel list 2>&1 | Select-String -Pattern "\s$TunnelName\s"
if ($existing) {
    Write-Host "[tunnel] '$TunnelName' already exists, reusing it"
} else {
    Write-Host "[tunnel] creating '$TunnelName'"
    & $cf tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) { throw 'could not create the tunnel' }
}

$idLine = (& $cf tunnel list 2>&1 | Select-String -Pattern "\s$TunnelName\s" | Select-Object -First 1).ToString()
$tunnelId = ($idLine -split '\s+' | Where-Object { $_ -match '^[0-9a-f-]{36}$' } | Select-Object -First 1)
if (-not $tunnelId) { throw "could not read the tunnel id from: $idLine" }
Write-Host "[tunnel] id $tunnelId"

# --- what it serves ---------------------------------------------------------
$credentials = Join-Path $cfDir "$tunnelId.json"
@"
# Written by scripts/setup-named-tunnel.ps1. One tunnel, one hostname, one local port.
tunnel: $tunnelId
credentials-file: $credentials

ingress:
  - hostname: $Hostname
    service: http://localhost:$Port
  # Anything else that reaches this tunnel is not ours to answer.
  - service: http_status:404
"@ | Set-Content -Path $config -Encoding ascii

Write-Host "[config] $config -> http://localhost:$Port"

# --- the DNS record ---------------------------------------------------------
# Points the hostname at this tunnel. Safe to re-run; it overwrites its own record.
Write-Host "[dns] pointing $Hostname at the tunnel"
& $cf tunnel route dns --overwrite-dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) { throw "could not create the DNS record for $Hostname" }

[System.IO.File]::WriteAllText($urlFile, "https://$Hostname")

Write-Host ''
Write-Host "Done. The shop's address is now:" -ForegroundColor Green
Write-Host "    $Hostname"
Write-Host ''
Write-Host 'Restart the watchdog window and it will serve this hostname instead of a rotating one.'
