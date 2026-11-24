# Installs Uhlaka on Windows from its GitHub releases, checked against the
# release's checksums before anything is put in place.
#
#   irm https://github.com/uhlaka-devs/uhlaka/releases/download/v0.1.0-alpha.9/install.ps1 | iex
#
# The program goes in %LOCALAPPDATA%\uhlaka\bin, which is added to your PATH.
# Run again to update. $env:INSTALL_VERSION picks a version; $env:RELEASE_URL
# a folder of release files, to try a build.
$ErrorActionPreference = 'Stop'

# The product's name, as in src/core/name.ts (a test keeps them the same).
$Name = 'uhlaka'
$Repository = 'uhlaka-devs/uhlaka'

if (-not [Environment]::Is64BitOperatingSystem) { throw "$Name needs 64-bit Windows" }
$File = "$Name-windows-x64.exe"
if ($env:RELEASE_URL) { $Base = $env:RELEASE_URL }
elseif ($env:INSTALL_VERSION) { $Base = "https://github.com/$Repository/releases/download/v$($env:INSTALL_VERSION.TrimStart('v'))" }
else {
  # The newest release, a pre-release among them: during alpha and beta those are all there is (ADR 0045).
  $Listed = @(Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repository/releases?per_page=1")
  if (-not $Listed -or -not $Listed[0].tag_name) { throw "GitHub lists no release of $Repository yet" }
  $Base = "https://github.com/$Repository/releases/download/$($Listed[0].tag_name)"
}

$Work = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
New-Item -ItemType Directory -Path $Work | Out-Null
try {
  Write-Host "Downloading $File..."
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$File" -OutFile (Join-Path $Work $File)
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/checksums.sha256" -OutFile (Join-Path $Work 'checksums.sha256')

  # The file must be the one the release lists, byte for byte.
  $Line = Get-Content (Join-Path $Work 'checksums.sha256') | Where-Object { ($_ -split '\s+')[1] -eq $File } | Select-Object -First 1
  if (-not $Line) { throw "the release lists no checksum for $File" }
  $Expected = ($Line -split '\s+')[0].ToLower()
  $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Work $File)).Hash.ToLower()
  if ($Actual -ne $Expected) { throw "$File does not match its checksum; nothing was installed" }

  $Bin = Join-Path $env:LOCALAPPDATA "$Name\bin"
  New-Item -ItemType Directory -Force -Path $Bin | Out-Null
  $Target = Join-Path $Bin "$Name.exe"
  # A running program can be renamed, not written over.
  if (Test-Path $Target) { Move-Item -Force $Target "$Target.old" }
  Move-Item -Force (Join-Path $Work $File) $Target
  Remove-Item -Force "$Target.old" -ErrorAction SilentlyContinue

  $Path = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($Path -split ';') -contains $Bin)) {
    [Environment]::SetEnvironmentVariable('Path', (@($Path, $Bin) | Where-Object { $_ }) -join ';', 'User')
    Write-Host "Added $Bin to your PATH; open a new terminal to use it."
  }
  Write-Host "Installed $(& $Target version) in $Bin."
  Write-Host "In a folder for your site, run: $Name"
}
finally {
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}
