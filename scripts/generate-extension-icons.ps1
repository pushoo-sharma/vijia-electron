# Regenerate Chrome toolbar icons from brand IJI face PNG.
$src = Join-Path $PSScriptRoot "..\public\Logotipo\RGB\PNG\Vijia-LogotipoRGB_RostoGelo.png"
$outDir = Join-Path $PSScriptRoot "..\extension\icons"
Add-Type -AssemblyName System.Drawing

function Save-Icon($size, $name, [scriptblock]$drawExtra) {
  $srcImg = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
  $pad = [Math]::Max(1, [int]($size * 0.06))
  $inner = $size - 2 * $pad
  $g.DrawImage($srcImg, $pad, $pad, $inner, $inner)
  & $drawExtra $g $size
  $path = Join-Path $outDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $srcImg.Dispose()
}

foreach ($sz in @(16, 32)) {
  Save-Icon $sz "iji-awake-$sz.png" { param($g, $s) }
  Save-Icon $sz "iji-sleeping-$sz.png" {
    param($g, $s)
    $eyeH = [Math]::Max(2, [int]($s * 0.09))
    $eyeW = [Math]::Max(4, [int]($s * 0.22))
    $y = [int]($s * 0.36)
    $x1 = [int]($s * 0.28)
    $x2 = [int]($s * 0.58)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 34, 34, 45))
    $g.FillRectangle($brush, $x1, $y, $eyeW, $eyeH)
    $g.FillRectangle($brush, $x2, $y, $eyeW, $eyeH)
    $brush.Dispose()
  }
  Save-Icon $sz "iji-glowing-$sz.png" {
    param($g, $s)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 34, 197, 94)), ([Math]::Max(2, [int]($s * 0.14)))
    $g.DrawEllipse($pen, 1, 1, $s - 2, $s - 2)
    $pen.Dispose()
  }
}

Write-Host "Wrote icons to $outDir"
