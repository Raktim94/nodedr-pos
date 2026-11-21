<#
  End-to-end test of the INSTALLED Store-style package on Windows (CI, or a clean
  VM). Run after Add-AppxPackage. Exercises: Start-menu activation, readiness,
  data location, first-run + sale, relaunch persistence, clean shutdown, hard-kill
  cleanup, occupied ports, offline, in-place app upgrade, old-database migration,
  uninstall/reinstall data retention. Hardware (scanner/printer/camera) is NOT
  covered: see packaging/windows-store/README.md.
#>
param(
  [Parameter(Mandatory)] [string]$PackageName,
  [Parameter(Mandatory)] [string]$Dist,
  [string]$UpgradeVersion,
  [string]$IdentityName,
  [string]$PublisherCn
)
$ErrorActionPreference = "Stop"
$script:fail = 0
function Check($name, [bool]$ok, $detail = "") {
  if ($ok) { Write-Host "  [PASS] $name" -ForegroundColor Green } else { Write-Host "  [FAIL] $name $detail" -ForegroundColor Red; $script:fail++ }
}
function Group($t) { Write-Host "::group::$t" }
function EndGroup { Write-Host "::endgroup::" }

$pkg = Get-AppxPackage -Name $PackageName | Select-Object -First 1
if (-not $pkg) { throw "package $PackageName is not installed" }
$pfn = $pkg.PackageFamilyName
$install = $pkg.InstallLocation
$localRoot = Join-Path $env:LOCALAPPDATA "Packages\$pfn"
$data = Join-Path $localRoot "LocalState\NodeDRPOS"
$aumid = "$pfn!NodeDRPOS"
$nodeExe = Join-Path $install "resources\nodedr\runtime\node.exe"
Write-Host "package family: $pfn`ninstall:        $install`ndata folder:    $data"

function Launch { Remove-Item (Join-Path $data "runtime.json") -Force -ErrorAction SilentlyContinue; Start-Process explorer.exe "shell:AppsFolder\$aumid" }
function Dump-Logs {
  foreach ($f in "shell.log", "backend.log", "frontend.log", "migration.log") {
    $p = Join-Path $data "logs\$f"
    if (Test-Path $p) { Write-Host "--- $f (tail) ---"; Get-Content $p -Tail 60 }
  }
}
function Wait-Ready([int]$timeout = 150) {
  $end = (Get-Date).AddSeconds($timeout)
  $rt = Join-Path $data "runtime.json"
  while ((Get-Date) -lt $end) {
    if (Test-Path $rt) {
      try { $j = Get-Content $rt -Raw | ConvertFrom-Json; if ($j.state -eq "ready") { return $j } } catch {}
    }
    Start-Sleep -Milliseconds 500
  }
  Dump-Logs
  throw "the app did not become ready within ${timeout}s"
}
function App-Procs { Get-Process -Name NodeDRPOS -ErrorAction SilentlyContinue }
function Node-Procs { Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$install*" } }
function Wait-Gone([int]$seconds = 25) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) { if (-not (App-Procs) -and -not (Node-Procs)) { return $true }; Start-Sleep -Milliseconds 300 }
  return $false
}
function Close-Gracefully {
  $main = App-Procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($main) { [void]$main.CloseMainWindow() }
  return (Wait-Gone 30)
}
function Hard-Kill { App-Procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 | ForEach-Object { Stop-Process -Id $_.Id -Force } }
function Stop-Everything { App-Procs | Stop-Process -Force -ErrorAction SilentlyContinue; Node-Procs | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep 2 }
function Base($rt) { "http://127.0.0.1:$($rt.gatewayPort)" }
function Api($rt, $method, $path, $body, $session) {
  $a = @{ Uri = "$(Base $rt)/api$path"; Method = $method; ContentType = "application/json"; WebSession = $session; UseBasicParsing = $true; TimeoutSec = 20 }
  if ($body) { $a.Body = $body }
  Invoke-RestMethod @a
}

# -------------------------------------------------------------------------------------
Group "1. First launch from the Start-menu entry"
Stop-Everything
if (Test-Path $data) { Remove-Item $data -Recurse -Force }
Launch
$rt = Wait-Ready
Write-Host "ready: $($rt | ConvertTo-Json -Compress)"
$main = App-Procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
Check "a normal top-level window exists" ($null -ne $main) "(no NodeDRPOS process has a main window)"
if ($main) { Check "window title mentions NodeDR POS" ($main.MainWindowTitle -match "NodeDR|Nodedr") "(title='$($main.MainWindowTitle)')" }
Check "database created in the package LocalState folder" (Test-Path (Join-Path $data "pos.db"))
Check "nothing written inside the read-only install folder" (-not (Get-ChildItem $install -Recurse -Filter pos.db -ErrorAction SilentlyContinue))
Check "no virtualised copy of the data under LocalCache" (-not (Get-ChildItem (Join-Path $localRoot "LocalCache") -Recurse -Filter pos.db -ErrorAction SilentlyContinue))
Check "session secret generated in the data folder" (Test-Path (Join-Path $data ".jwt-secret"))
Check "exactly two bundled node.exe children" ((Node-Procs | Measure-Object).Count -eq 2) "(found $((Node-Procs | Measure-Object).Count))"
$ids = @(App-Procs | ForEach-Object { $_.Id }) + @(Node-Procs | ForEach-Object { $_.Id })
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess }
Check "listening sockets exist" (($listen | Measure-Object).Count -ge 3)
Check "every listener is loopback only (no firewall prompt, no LAN exposure)" (-not ($listen | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") })) "($(($listen | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', '))"
$h = Invoke-RestMethod "$(Base $rt)/api/health" -TimeoutSec 20
Check "health through the gateway reports ok" ($h.status -eq "ok")
$page = Invoke-WebRequest "$(Base $rt)/" -UseBasicParsing
Check "web UI is served" ($page.StatusCode -eq 200 -and $page.Content.Length -gt 500)
Check "not yet onboarded (fresh install shows onboarding, no default password)" ((Invoke-RestMethod "$(Base $rt)/api/auth/status").onboarded -eq $false)
$hostResp = Invoke-WebRequest "http://127.0.0.1:$($rt.gatewayPort)/" -Headers @{ Host = "evil.example" } -UseBasicParsing -SkipHttpErrorCheck
Check "other Host headers are refused" ($hostResp.StatusCode -eq 421) "(status $($hostResp.StatusCode))"
EndGroup

Group "2. Onboarding + a real sale through the app's own origin"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Api $rt Post "/auth/register" '{"name":"CI Admin","email":"ci@test.local","password":"Str0ngPass!23"}' $s | Out-Null
Api $rt Post "/settings" '{"shopName":"CI Test Shop","address1":"1 Test Street","gstEnabled":true,"defaultTaxRate":18}' $s | Out-Null
$prod = Api $rt Post "/products" '{"name":"Test Widget","barcode":"2000000000015","sellingPrice":118,"purchasePrice":80,"stock":10,"taxRate":18}' $s
$scan = Api $rt Get "/products/scan/2000000000015" $null $s
Check "barcode lookup finds the product" ($scan.product.id -eq $prod.id)
$sale = Api $rt Post "/invoices" ("{`"items`":[{`"productId`":$($prod.id),`"quantity`":2}],`"paymentMethod`":`"CASH`",`"amountPaid`":236}") $s
Check "GST-inclusive total (236)" ([math]::Round($sale.totalAmount) -eq 236) "(got $($sale.totalAmount))"
$stockNow = (Api $rt Get "/products" $null $s | Where-Object { $_.id -eq $prod.id }).stock
Check "inventory reduced by the sale (10 -> 8)" ($stockNow -eq 8) "(stock=$stockNow)"
$rc = Invoke-WebRequest "$(Base $rt)/api/print/$($sale.id)/receipt" -WebSession $s -UseBasicParsing
Check "receipt renders" ($rc.Content -match "window.print|Test Widget")
$pdfPath = Join-Path $env:TEMP "nodedr-r.pdf"
Invoke-WebRequest "$(Base $rt)/api/print/$($sale.id)/pdf" -WebSession $s -UseBasicParsing -OutFile $pdfPath
Check "receipt PDF is a PDF" ([System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($pdfPath)[0..3]) -eq "%PDF")
$unmatched = Invoke-WebRequest "$(Base $rt)/api/products/scan/9999999999999" -WebSession $s -UseBasicParsing -SkipHttpErrorCheck
Check "unknown barcode is a clean 404" ($unmatched.StatusCode -eq 404)
EndGroup

Group "3. Close -> nothing left running"
$clean = Close-Gracefully
Check "closing the window stops the app and both node.exe processes" $clean
Check "runtime.json removed on exit" (-not (Test-Path (Join-Path $data "runtime.json")))
$wal = Join-Path $data "pos.db-wal"
Check "SQLite WAL folded back into pos.db on exit" ((-not (Test-Path $wal)) -or ((Get-Item $wal).Length -eq 0))
EndGroup

Group "4. Relaunch: accounts, settings, products and sales persist"
Launch
$rt = Wait-Ready
$s2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Api $rt Post "/auth/login" '{"email":"ci@test.local","password":"Str0ngPass!23"}' $s2 | Out-Null
Check "same admin can sign in" $true
Check "shop settings kept" ((Api $rt Get "/settings" $null $s2).shopName -eq "CI Test Shop")
$inv = Api $rt Get "/invoices" $null $s2
Check "sale kept" (@($inv).Count -ge 1 -or @($inv.items).Count -ge 1)
Check "stock still 8" ((Api $rt Get "/products" $null $s2 | Where-Object { $_.name -eq "Test Widget" }).stock -eq 8)
EndGroup

Group "5. Hard kill (crash) leaves no orphan processes"
Hard-Kill
Check "node.exe children exit by themselves when the app is killed" (Wait-Gone 25)
EndGroup

Group "6. Occupied ports: never attach to an unrelated service"
$squatScript = Join-Path $env:TEMP "nodedr-squat.ps1"
@'
$ls = foreach ($p in 19940..19949) { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $p); $l.ExclusiveAddressUse = $true; $l.Start(); $l }
Start-Sleep -Seconds 900
'@ | Set-Content $squatScript -Encoding UTF8
$squat = Start-Process pwsh -ArgumentList "-NoProfile", "-File", $squatScript -PassThru -WindowStyle Hidden
$held = 0
foreach ($i in 1..20) { $held = (Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 19940..19949 } | Measure-Object).Count; if ($held -ge 10) { break }; Start-Sleep 1 }
Check "test squatter holds all preferred ports" ($held -ge 10) "(holds $held)"
Launch
$rt = Wait-Ready
Check "app picked a free port instead of a busy one" ($rt.gatewayPort -notin 19940..19949) "(port $($rt.gatewayPort))"
Check "app works on the fallback port" ((Invoke-RestMethod "$(Base $rt)/api/health" -TimeoutSec 20).status -eq "ok")
Check "closed cleanly" (Close-Gracefully)
Stop-Process -Id $squat.Id -Force -ErrorAction SilentlyContinue
EndGroup

Group "7. Offline start and operation"
$rules = @()
foreach ($exe in (Join-Path $install "NodeDRPOS.exe"), $nodeExe) {
  $rules += New-NetFirewallRule -DisplayName "nodedr-offline-test" -Direction Outbound -Action Block -Program $exe
}
try {
  Launch
  $rt = Wait-Ready
  $s3 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Api $rt Post "/auth/login" '{"email":"ci@test.local","password":"Str0ngPass!23"}' $s3 | Out-Null
  $prod = Api $rt Get "/products" $null $s3 | Where-Object { $_.name -eq "Test Widget" }
  $sale2 = Api $rt Post "/invoices" ("{`"items`":[{`"productId`":$($prod.id),`"quantity`":1}],`"paymentMethod`":`"CASH`",`"amountPaid`":118}") $s3
  Check "starts and sells with outbound network blocked" ($sale2.id -gt 0)
  Check "closed cleanly" (Close-Gracefully)
} finally { Get-NetFirewallRule -DisplayName "nodedr-offline-test" -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
EndGroup

Group "8. Migrating an older database (pre-migration backup, data kept)"
Stop-Everything
$be = Join-Path $install "resources\nodedr\backend"
$scratch = Join-Path $env:TEMP "nodedr-old-db"
if (Test-Path $scratch) { Remove-Item $scratch -Recurse -Force }
$trim = Join-Path $env:TEMP "nodedr-trimmed-migrations"
if (Test-Path $trim) { Remove-Item $trim -Recurse -Force }
Copy-Item (Join-Path $be "prisma\migrations") $trim -Recurse
Get-ChildItem $trim -Directory | Sort-Object Name | Select-Object -Skip 10 | Remove-Item -Recurse -Force
& $nodeExe (Join-Path $be "src\desktop\dbtool.js") prepare --data $scratch --migrations $trim | Out-Null
$seedJs = Join-Path $env:TEMP "nodedr-seed.js"
@'
const D = require(process.argv[2]);
const d = new D(process.argv[3]);
d.prepare("INSERT INTO User (name,email,password,role) VALUES ('Old Owner','old@test.local','x','admin')").run();
d.pragma('wal_checkpoint(TRUNCATE)'); d.close();
'@ | Set-Content $seedJs -Encoding UTF8
& $nodeExe $seedJs (Join-Path $be "node_modules\better-sqlite3") (Join-Path $scratch "pos.db")
$keep = "$data.keep"
if (Test-Path $keep) { Remove-Item $keep -Recurse -Force }
Move-Item $data $keep
New-Item -ItemType Directory -Force -Path $data | Out-Null
Copy-Item (Join-Path $scratch "pos.db") (Join-Path $data "pos.db")
Launch
$rt = Wait-Ready
Check "old database upgraded and the app is up" ((Invoke-RestMethod "$(Base $rt)/api/health" -TimeoutSec 20).status -eq "ok")
Check "existing user survived the upgrade (no onboarding shown)" ((Invoke-RestMethod "$(Base $rt)/api/auth/status").onboarded -eq $true)
$bk = Get-ChildItem (Join-Path $data "backups") -Filter "pos-pre-migration-*.db" -ErrorAction SilentlyContinue
Check "a verified pre-migration backup was written" (($bk | Measure-Object).Count -ge 1)
Check "closed cleanly" (Close-Gracefully)
Remove-Item $data -Recurse -Force
Move-Item $keep $data
EndGroup

if ($UpgradeVersion) {
  Group "9. In-place app upgrade keeps the data"
  $beforeUsers = (Get-Item (Join-Path $data "pos.db")).Length
  & pwsh -File "$PSScriptRoot\..\build-msix.ps1" -Repack -Version $UpgradeVersion -OutDir $Dist -PackageIdentityName $IdentityName -PublisherCn $PublisherCn -SelfSignForTesting
  if ($LASTEXITCODE -ne 0) { throw "repack failed" }
  $up = Get-ChildItem (Join-Path $Dist "Nodedr-POS-$UpgradeVersion.0-x64.msix") | Select-Object -First 1
  Add-AppxPackage -Path $up.FullName -ForceUpdateFromAnyVersion
  $pkg2 = Get-AppxPackage -Name $PackageName | Select-Object -First 1
  Check "package updated to $UpgradeVersion.0" ($pkg2.Version -eq "$UpgradeVersion.0") "(now $($pkg2.Version))"
  Check "same package family (Store would treat it as the same app)" ($pkg2.PackageFamilyName -eq $pfn)
  Check "data folder still there after the update" (Test-Path (Join-Path $data "pos.db"))
  $install = $pkg2.InstallLocation
  Launch
  $rt = Wait-Ready
  $s4 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Api $rt Post "/auth/login" '{"email":"ci@test.local","password":"Str0ngPass!23"}' $s4 | Out-Null
  Check "admin, products and sales readable after the update" ((Api $rt Get "/products" $null $s4 | Where-Object { $_.name -eq "Test Widget" }).stock -eq 7)
  Check "closed cleanly" (Close-Gracefully)
  EndGroup
}

Group "10. Uninstall / reinstall: what actually happens to the data"
$pkgNow = Get-AppxPackage -Name $PackageName | Select-Object -First 1
Remove-AppxPackage -Package $pkgNow.PackageFullName
Start-Sleep 5
Check "package removed" (-not (Get-AppxPackage -Name $PackageName))
$retained = Test-Path (Join-Path $data "pos.db")
Write-Host "  [INFO] database still present after uninstall: $retained"
Write-Host "##[notice]Uninstall data retention observed on this OS: pos.db retained = $retained"
"uninstall_retains_data=$retained" | Out-File (Join-Path $Dist "uninstall-observation.txt") -Encoding ascii
EndGroup

if ($script:fail -gt 0) { Write-Host "`n$($script:fail) check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host "`nAll end-to-end checks passed" -ForegroundColor Green
