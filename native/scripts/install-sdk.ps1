# Install Android SDK command-line tools + platform packages (no Studio Setup Wizard needed).
# ASCII only: Windows PowerShell 5.1 reads .ps1 as ANSI, so non-ASCII breaks parsing.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$jdk = $null
foreach ($cand in @(
  'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot',
  'C:\Program Files\Android\Android Studio\jbr'
)) { if (-not $jdk -and (Test-Path (Join-Path $cand 'bin\java.exe'))) { $jdk = $cand } }
if (Get-ChildItem 'C:\Program Files\Microsoft' -Filter 'jdk-*' -Directory -ErrorAction SilentlyContinue) {
  $j = (Get-ChildItem 'C:\Program Files\Microsoft' -Filter 'jdk-*' -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
  if (Test-Path (Join-Path $j 'bin\java.exe')) { $jdk = $j }
}
if (-not $jdk) { throw 'JDK not found (install JDK 17/21 first)' }
$env:JAVA_HOME = $jdk
$env:PATH = (Join-Path $jdk 'bin') + ';' + $env:PATH
Write-Host ("JDK: " + $jdk)

New-Item -ItemType Directory -Force -Path $sdk | Out-Null
$zip = Join-Path $env:TEMP 'cmdline-tools.zip'
$url = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'

if (-not (Test-Path $zip) -or (Get-Item $zip).Length -lt 100MB) {
  Write-Host 'Downloading cmdline-tools (133MB) ...'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}
Write-Host 'Extracting ...'
$tmp = Join-Path $env:TEMP 'cmdline-tools-extract'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$dest = Join-Path $sdk 'cmdline-tools\latest'
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Move-Item (Join-Path $tmp 'cmdline-tools') $dest

$sdkm = Join-Path $dest 'bin\sdkmanager.bat'
if (-not (Test-Path $sdkm)) { throw "sdkmanager missing: $sdkm" }

Write-Host 'Accepting licenses ...'
$yes = (1..40 | ForEach-Object { 'y' }) -join "`n"
$yes | & $sdkm "--sdk_root=$sdk" --licenses | Out-Null

Write-Host 'Installing platform-tools / android-34 / build-tools 34.0.0 ...'
& $sdkm "--sdk_root=$sdk" 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0'

Write-Host 'Installed packages:'
& $sdkm "--sdk_root=$sdk" --list_installed
Write-Host ("SDK ready: " + $sdk)
