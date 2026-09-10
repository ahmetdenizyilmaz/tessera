# Read an API key that Tessera saved in the Windows Credential Manager, so
# terminal launchers reuse the key you entered once in the app.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tessera-key.ps1 openrouter
#
# Prints the key to stdout, or nothing (exit 1) when it isn't stored.
# Tessera uses keyring-rs with service "tessera-llm"; on Windows that lands as
# target "<provider>.tessera-llm" with the secret blob in UTF-16LE.
param([Parameter(Mandatory = $true)][string]$Provider)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class TesseraCred {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
}
'@

$target = "$Provider.tessera-llm"
$ptr = [IntPtr]::Zero
if (-not [TesseraCred]::CredReadW($target, 1, 0, [ref]$ptr)) {
    exit 1
}
try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type]([TesseraCred+CREDENTIAL]))
    if ($cred.CredentialBlobSize -le 0) { exit 1 }
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    # keyring-rs writes UTF-16LE; fall back to UTF-8 for keys written by other tools
    $key = [Text.Encoding]::Unicode.GetString($bytes)
    if ($key -notmatch '^[\x20-\x7E]+$') { $key = [Text.Encoding]::UTF8.GetString($bytes) }
    Write-Output $key.Trim()
}
finally {
    [TesseraCred]::CredFree($ptr)
}
