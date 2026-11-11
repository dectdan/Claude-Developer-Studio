Add-Type -AssemblyName System.Drawing

# Create a simple 32x32 icon with "C" for Claude
$size = 32
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Clear with transparent
$graphics.Clear([System.Drawing.Color]::Transparent)

# Draw blue circle background
$blueBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(41, 98, 255))
$graphics.FillEllipse($blueBrush, 2, 2, $size-4, $size-4)

# Draw white "C"
$whitePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 3.5)
$whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($whitePen, 8, 8, 16, 16, 45, 270)

# Save bitmap first
$bmp.Save("D:\Projects\ClaudeDevStudio\ClaudeDevStudio.UI\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)

# Convert to icon
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$iconStream = New-Object System.IO.FileStream("D:\Projects\ClaudeDevStudio\ClaudeDevStudio.UI\icon.ico", [System.IO.FileMode]::Create)
$icon.Save($iconStream)
$iconStream.Close()

# Cleanup
$graphics.Dispose()
$bmp.Dispose()
$blueBrush.Dispose()
$whitePen.Dispose()

Write-Host "Icon created successfully at: D:\Projects\ClaudeDevStudio\ClaudeDevStudio.UI\icon.ico"
