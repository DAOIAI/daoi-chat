# SPDX-License-Identifier: AGPL-3.0-or-later

$ErrorActionPreference = 'Stop'
$arch = $env:ARCH
$version = $env:VERSION
if ($arch -notin @('x64', 'arm64')) { throw 'ARCH must be x64 or arm64' }
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'VERSION must be numeric calver' }

$unpacked = Get-ChildItem dist-electron -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'DAOI Chat.exe') } |
    Select-Object -First 1
if (!$unpacked) { throw 'DAOI Chat.exe was not packaged' }

$release = "dist-electron/velopack-windows-$arch"
$staging = '../upload_staging'
New-Item -ItemType Directory -Force $release, $staging | Out-Null

# Use the upstream Velopack format with DAOI's own identity. Signing can be added
# when DAOI has a certificate; Fluxer's Azure credentials do not apply to this app.
& ./.velopack/vpk.exe --yes pack `
    --packId daoi_chat_desktop `
    --packVersion $version `
    --packDir $unpacked.FullName `
    --mainExe 'DAOI Chat.exe' `
    --packTitle 'DAOI Chat' `
    --packAuthors DAOI `
    --shortcuts 'Desktop,StartMenu' `
    --runtime "win-$arch" `
    --icon build_resources/icons-daoi/icon.ico `
    --outputDir $release `
    --delta None
if ($LASTEXITCODE -ne 0) { throw "Velopack failed: $LASTEXITCODE" }

foreach ($required in @('RELEASES', 'releases.win.json')) {
    if (!(Test-Path "$release/$required")) { throw "Missing $required" }
}
if (!(Get-ChildItem "$release/*-full.nupkg")) { throw 'Missing full update package' }
$installer = Get-ChildItem "$release/*Setup.exe" | Select-Object -First 1
if (!$installer) { throw 'Missing installer' }

# Keep one consistently named setup and one portable ZIP per architecture.
Copy-Item $installer.FullName "$staging/DAOI-Chat-$version-setup-win-$arch.exe"
Get-ChildItem $release -File | Where-Object { $_.Extension -ne '.exe' -and $_.Extension -ne '.zip' } |
    Copy-Item -Destination $staging
$marker = Join-Path $unpacked.FullName '.portable'
try {
    Set-Content $marker '' -NoNewline
    & 7z a -tzip "$staging/DAOI-Chat-$version-portable-win-$arch.zip" "$($unpacked.FullName)\*" -mx=1
    if ($LASTEXITCODE -ne 0) { throw "Portable ZIP failed: $LASTEXITCODE" }
} finally {
    Remove-Item $marker -ErrorAction SilentlyContinue
}
Get-ChildItem $staging -File | Where-Object { $_.Name -ne 'SHA256SUMS' } | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($_.Name)"
} | Set-Content "$staging/SHA256SUMS" -Encoding ascii
