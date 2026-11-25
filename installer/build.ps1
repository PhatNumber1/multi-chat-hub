# Builds dist\MultiChatHub-Setup-<version>.exe with the C# compiler that comes with Windows.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = [regex]::Match((Get-Content "$root\js\config.js" -Raw), "version: '([0-9.]+)'").Groups[1].Value
if (-not $version) { throw 'No version in js\config.js' }
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$dist = "$root\dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$info = Join-Path $env:TEMP "mch-version-$PID.cs"
"[assembly: System.Reflection.AssemblyVersion(`"$version.0`")]`n[assembly: System.Reflection.AssemblyFileVersion(`"$version.0`")]" | Set-Content $info -Encoding UTF8
$files = @(Get-Item "$root\dock.html", "$root\README.md") + @(Get-ChildItem "$root\css", "$root\js" -File)
$res = $files | ForEach-Object { '/resource:' + $_.FullName + ',app/' + $_.FullName.Substring($root.Length + 1).Replace('\', '/') }
$out = "$dist\MultiChatHub-Setup-$version.exe"
& $csc /nologo /target:winexe /platform:anycpu /optimize+ "/out:$out" "/win32icon:$PSScriptRoot\logo.ico" "/resource:$PSScriptRoot\logo.png,logo.png" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $res "$PSScriptRoot\Installer.cs" $info
$code = $LASTEXITCODE
Remove-Item $info
if ($code -ne 0) { throw "Compiler failed ($code)" }
Get-Item $out | Select-Object Name, Length
(Get-FileHash $out -Algorithm SHA256).Hash
