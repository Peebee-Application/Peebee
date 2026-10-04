# Export the owner's PNG artwork, preserving the logo's transparent surround.
$ErrorActionPreference = 'Stop'
$brandRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Add-Type -AssemblyName System.Drawing
$lightLogo = [System.Drawing.Image]::FromFile((Join-Path $brandRoot 'assets/brand/logo-light.png'))
$darkLogo = [System.Drawing.Image]::FromFile((Join-Path $brandRoot 'assets/brand/logo-dark.png'))

function Export-LogoPng($image, [int]$size, [string]$destination, $background) {
  # Header logos keep the source transparency. Installed app icons get a
  # solid white background for platforms that require opaque icons.
  $pixelFormat = if ($background.A -eq 0) { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, $pixelFormat)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  try {
    $graphics.Clear($background)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # Clamp edge sampling to the source artwork instead of sampling transparency outside it.
    $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $rectangle = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $graphics.DrawImage($image, $rectangle, 0, 0, $image.Width, $image.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
    $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $attributes.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  foreach ($appName in @('web','customer','rider','admin','restaurant','merchant','partner')) {
    $publicPath = Join-Path $brandRoot "apps/$appName/public"
    foreach ($lightName in @('peebee-logo-light.png','peebee-logo-navy.png')) {
      Export-LogoPng $lightLogo 256 (Join-Path $publicPath "brand/$lightName") ([System.Drawing.Color]::Transparent)
    }
    foreach ($darkName in @('peebee-logo-dark.png','peebee-logo-white.png')) {
      Export-LogoPng $darkLogo 256 (Join-Path $publicPath "brand/$darkName") ([System.Drawing.Color]::Transparent)
    }
    foreach ($icon in @(@('favicon-32.png',32),@('apple-touch-icon.png',180),@('icon-192.png',192),@('icon-512.png',512))) {
      Export-LogoPng $lightLogo $icon[1] (Join-Path $publicPath "icons/$($icon[0])") ([System.Drawing.Color]::White)
    }
    $pngData = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $publicPath 'icons/icon-512.png')))
    $iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,' + $pngData + '"/></svg>'
    foreach ($svgPath in @('brand/app-icon.svg','favicon.svg')) {
      $targetSvg = Join-Path $publicPath $svgPath
      if (Test-Path -LiteralPath $targetSvg) { [IO.File]::WriteAllText($targetSvg,$iconSvg) }
    }
  }
  Write-Output 'Exported supplied light/dark PNG logos and app icons for all seven frontends.'
} finally {
  $lightLogo.Dispose()
  $darkLogo.Dispose()
}
