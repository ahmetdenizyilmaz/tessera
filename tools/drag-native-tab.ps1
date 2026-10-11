param([int]$StartX, [int]$StartY, [int]$EndX, [int]$EndY)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TestMouse {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
$previousDpi = [TestMouse]::SetThreadDpiAwarenessContext([IntPtr](-4))
$null = [TestMouse]::SetCursorPos($StartX, $StartY)
Start-Sleep -Milliseconds 100
[TestMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
try {
  for ($step = 1; $step -le 24; $step++) {
    $null = [TestMouse]::SetCursorPos([int]($StartX + ($EndX - $StartX) * $step / 24), [int]($StartY + ($EndY - $StartY) * $step / 24))
    Start-Sleep -Milliseconds 30
  }
} finally {
  [TestMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  $null = [TestMouse]::SetThreadDpiAwarenessContext($previousDpi)
}
