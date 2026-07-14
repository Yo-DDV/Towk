param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]] $Paths
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$resolvedPaths = @($Paths | ForEach-Object { (Resolve-Path -LiteralPath $_).ProviderPath })
$files = [System.Collections.Specialized.StringCollection]::new()
$files.AddRange([string[]] $resolvedPaths)

$written = $false
for ($attempt = 0; $attempt -lt 10; $attempt++) {
  try {
    [System.Windows.Forms.Clipboard]::SetFileDropList($files)
    $written = $true
    break
  }
  catch [System.Runtime.InteropServices.ExternalException] {
    Start-Sleep -Milliseconds 100
  }
}
if (-not $written) {
  throw 'The Windows clipboard stayed locked after 10 attempts.'
}

$readBack = @(
  [System.Windows.Forms.Clipboard]::GetFileDropList() |
    ForEach-Object { [string] $_ }
)
if ($readBack.Count -ne $resolvedPaths.Count) {
  throw "CF_HDROP read-back returned $($readBack.Count) files; expected $($resolvedPaths.Count)."
}

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
ConvertTo-Json -Compress -InputObject @($readBack)
