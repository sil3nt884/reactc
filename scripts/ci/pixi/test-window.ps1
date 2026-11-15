param([Parameter(Mandatory = $true)][string] $Executable)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PixiWindowProbe {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PostMessage(IntPtr window, uint message, UIntPtr keys, IntPtr point);

    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ClientToScreen(IntPtr window, ref Point point);
}
'@

$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$logs = Join-Path ([System.IO.Path]::GetTempPath()) ("reactc-pixi-" + [guid]::NewGuid())
New-Item -ItemType Directory $logs | Out-Null
$stdout = Join-Path $logs 'stdout.txt'
$stderr = Join-Path $logs 'stderr.txt'
$process = Start-Process $executablePath -ArgumentList '--smoke' -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$null = $process.Handle
try {
    $found = $false
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    while (!$process.HasExited -and $clock.Elapsed.TotalSeconds -lt 20) {
        $window = [PixiWindowProbe]::FindWindow('ReactcCanvasWindow', 'ReactC Canvas')
        if ($window -ne [IntPtr]::Zero) {
            $owner = [uint32]0
            [void][PixiWindowProbe]::GetWindowThreadProcessId($window, [ref]$owner)
            if ($owner -eq $process.Id) {
                if (![PixiWindowProbe]::SetWindowPos($window, [IntPtr]::Zero, 0, 0, 164, 141, 0x16)) {
                    throw 'Could not resize the PixiJS smoke test window'
                }
                $point = [IntPtr]::new((22 -shl 16) -bor 24)
                if (![PixiWindowProbe]::PostMessage($window, 0x0201, [UIntPtr]::new([uint32]1), $point) -or
                    ![PixiWindowProbe]::PostMessage($window, 0x0202, [UIntPtr]::Zero, $point) -or
                    ![PixiWindowProbe]::PostMessage($window, 0x0204, [UIntPtr]::new([uint32]2), $point) -or
                    ![PixiWindowProbe]::PostMessage($window, 0x0205, [UIntPtr]::Zero, $point)) {
                    throw 'Could not send pointer input to the PixiJS smoke test window'
                }
                $screen = New-Object PixiWindowProbe+Point
                $screen.X = 24
                $screen.Y = 22
                if (![PixiWindowProbe]::ClientToScreen($window, [ref]$screen)) {
                    throw 'Could not locate the PixiJS smoke test window'
                }
                $wheelPoint = [IntPtr]::new((($screen.Y -band 0xffff) -shl 16) -bor ($screen.X -band 0xffff))
                if (![PixiWindowProbe]::PostMessage($window, 0x020a, [UIntPtr]::new([uint32](120 -shl 16)), $wheelPoint)) {
                    throw 'Could not send wheel input to the PixiJS smoke test window'
                }
                $found = $true
                break
            }
        }
        Start-Sleep -Milliseconds 15
    }
    if (!$process.WaitForExit(10000)) {
        throw 'The PixiJS smoke test did not exit'
    }
    Get-Content -LiteralPath $stdout
    Get-Content -LiteralPath $stderr
    if (!$found -or $process.ExitCode -ne 0 -or
        !(Select-String -Quiet -LiteralPath $stdout -Pattern 'PixiJS Application WebGL draw, gradients, spritesheet, ticker, resize and mouse input passed')) {
        throw "The PixiJS native Windows smoke test failed. Exit code: $($process.ExitCode)"
    }
} finally {
    if (!$process.HasExited) { $process.Kill() }
    Remove-Item -LiteralPath $logs -Recurse -Force
}
