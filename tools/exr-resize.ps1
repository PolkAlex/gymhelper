# [EXR-T2] Resize exercise photos in place to MaxSide px on the long side (JPEG q80).
# Local one-off step for web/img/exercises (Windows: System.Drawing / GDI+).
# Node alone cannot resize JPEG; originals can be re-downloaded via tools/exr-import.mjs.
# Usage: powershell -File tools/exr-resize.ps1 [-Dir web/img/exercises] [-MaxSide 600] [-Quality 80]
param(
    [string]$Dir = "web/img/exercises",
    [int]$MaxSide = 600,
    [int]$Quality = 80
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$files = @(Get-ChildItem -LiteralPath $Dir -Filter *.jpg)
$before = ($files | Measure-Object Length -Sum).Sum
$resized = 0

foreach ($f in $files) {
    # Image.FromFile лочит файл и Save в тот же путь падает (GDI+ generic error) —
    # читаем байты и декодируем из MemoryStream: файл свободен на момент Save
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $ms = New-Object System.IO.MemoryStream (,$bytes)
    $img = [System.Drawing.Image]::FromStream($ms)
    try {
        $w = $img.Width; $h = $img.Height
        $scale = [Math]::Min(1.0, $MaxSide / [Math]::Max($w, $h))
        if ($scale -lt 1.0) {
            $nw = [int][Math]::Round($w * $scale)
            $nh = [int][Math]::Round($h * $scale)
            $bmp = New-Object System.Drawing.Bitmap($nw, $nh)
            try {
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                try {
                    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $g.DrawImage($img, 0, 0, $nw, $nh)
                } finally { $g.Dispose() }
                $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
                $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
                try {
                    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
                    $bmp.Save($f.FullName, $codec, $ep)
                } finally { $ep.Dispose() }
            } finally { $bmp.Dispose() }
            $resized++
        }
    } finally {
        $img.Dispose()
        $ms.Dispose()
    }
}

$after = (Get-ChildItem -LiteralPath $Dir -Filter *.jpg | Measure-Object Length -Sum).Sum
Write-Host ("files={0} resized={1} before={2:N2}MB after={3:N2}MB" -f $files.Count, $resized, ($before/1MB), ($after/1MB))
