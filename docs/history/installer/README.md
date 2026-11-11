# ClaudeDevStudio - Installer Package

## 📦 You Have Everything You Need!

This folder contains a complete dual-distribution system for ClaudeDevStudio:
1. **MSIX Package** for Microsoft Store (your primary channel)
2. **MSI Installer** for GitHub/Direct distribution

## ✅ Files in This Folder

### Build Scripts:
- `Build-MSIX.ps1` - Creates Microsoft Store package (MSIX)
- `Build-MSI.ps1` - Creates traditional installer (MSI)

### Installer Definitions:
- `Package.appxmanifest` - Microsoft Store manifest
- `Installer.wxs` - WiX MSI installer definition

### Assets:
- Put your logo and icons in the `Assets\` folder
- Your logo file: `Cloud_Developer_Studio.png`

### Documentation (download from outputs folder):
- README.md - Complete distribution guide
- QUICKSTART.md - 3-step Store submission guide
- PrivacyPolicy.md - Store-required privacy policy
- StoreMetadata.md - Store listing content (copy-paste ready)
- DISTRIBUTION_COMPLETE.md - Overview and strategy

## 🚀 QUICK START - Microsoft Store (10 Minutes!)

### Step 1: Generate Icons (5 min)

**Option A - Online Tool (Easiest):**
1. Go to https://makeappicon.com/
2. Upload `Assets/Cloud_Developer_Studio.png`
3. Select "Windows" platform
4. Download all 7 icon sizes
5. Extract to `Assets/` folder

**Required icons:**
- Square44x44Logo.png (44×44)
- Square150x150Logo.png (150×150)
- Wide310x150Logo.png (310×150)
- LargeTile.png (310×310)
- SmallTile.png (71×71)
- StoreLogo.png (50×50)
- SplashScreen.png (620×300)

**Option B - ImageMagick:**
```powershell
winget install ImageMagick.ImageMagick
cd Assets
$src = "Cloud_Developer_Studio.png"
magick $src -resize 44x44 Square44x44Logo.png
magick $src -resize 150x150 Square150x150Logo.png  
magick $src -resize 310x150 Wide310x150Logo.png
magick $src -resize 310x310 LargeTile.png
magick $src -resize 71x71 SmallTile.png
magick $src -resize 50x50 StoreLogo.png
magick $src -resize 620x300 SplashScreen.png
```

### Step 2: Update Publisher (2 min)

Edit `Package.appxmanifest` line 8 and line 12:
```xml
<!-- Line 8: YOUR publisher name from Partner Center -->
<Identity ... Publisher="CN=YourPublisherName" />

<!-- Line 12: YOUR company name -->
<PublisherDisplayName>Your Company Name</PublisherDisplayName>
```

**Find your Publisher Name:**
- Log into https://partner.microsoft.com/dashboard
- Account settings → Identity details
- Copy "Publisher Display Name"  
- (Same one you use for AI Music Studio!)

### Step 3: Build MSIX (3 min)

```powershell
# Build the Microsoft Store package
.\Build-MSIX.ps1 -Publisher "CN=YourPublisherFromStep2"

# Output: Output\ClaudeDevStudio_1.0.0.0.msix
```

**Test locally (optional):**
```powershell
# Install on your machine
Add-AppxPackage Output\ClaudeDevStudio_1.0.0.0.msix

# Test it works
claudedev help

# Uninstall when done
Get-AppxPackage ClaudeDevStudio | Remove-AppxPackage
```

### Step 4: Submit to Microsoft Store!

1. Go to https://partner.microsoft.com/dashboard
2. Apps and games → New product → MSIX app
3. Reserve name: "Claude Developer Studio"
4. Upload your .msix file from Output folder
5. Fill in Store listing (see StoreMetadata.md for content)
6. Add 3-5 screenshots of the app
7. Submit for review

**Approval time: 24-48 hours** ✅


## 🔨 Building MSI Installer (For GitHub)

### Prerequisites:
```powershell
# Install WiX Toolset
winget install --id WixToolset.WixToolset
```

### Build:
```powershell
.\Build-MSI.ps1

# Output: Output\ClaudeDevStudio_1.0.0.0.msi
```

### Publish to GitHub:
1. Create release: `gh release create v1.0.0`
2. Upload MSI file
3. Add release notes
4. Publish!

## 📁 What Gets Installed?

### Microsoft Store (MSIX):
- Installs to: `C:\Program Files\WindowsApps\ClaudeDevStudio_...`
- Adds to PATH: User-level only (Store requirement)
- Memory folder: `Documents\ClaudeDevStudio\`
- Auto-updates: Yes

### GitHub/MSI:
- Installs to: `C:\Program Files\ClaudeDevStudio\`
- Adds to PATH: System-wide
- Memory folder: `OneDrive\Documents\ClaudeDevStudio\`
- Start menu shortcuts: Yes

## 🐛 Troubleshooting

**"makeappx.exe not found"**
- Install Windows SDK from https://developer.microsoft.com/windows/downloads/windows-sdk/

**"WiX Toolset not found"**
```powershell
winget install --id WixToolset.WixToolset
```

**"Publisher certificate invalid"**
- Update Publisher in Package.appxmanifest line 8
- Must match your Partner Center publisher name EXACTLY

**Build succeeds but install fails**
- Check you have all 7 icon files in Assets folder
- Verify Publisher name matches Partner Center


## 📋 Requirements

### To Build MSIX (Store):
- Windows 10 SDK (comes with Visual Studio)
- Your Microsoft Store publisher certificate
- All 7 icon files in Assets folder

### To Build MSI (GitHub):
- WiX Toolset v3.11+
- .NET 8.0 SDK

### To Submit to Store:
- Microsoft Partner Center account (✅ You have this!)
- 3-5 screenshots (1366×768 minimum)
- Privacy policy URL (template included)

## 📸 Take Screenshots

Before submitting to Store, take screenshots of:
1. `claudedev help` - Main command list
2. `claudedev backups` - Backup management
3. `claudedev stats` - Memory statistics  
4. `claudedev git status` - Git integration
5. Dashboard UI (if you build it)

## 🎯 Distribution Strategy

**Primary: Microsoft Store**
- You already have developer account
- Best discoverability
- Auto-updates
- Professional & trusted

**Secondary: GitHub Releases**
- For developers
- Offline installs
- Power users

**Tertiary: Winget**
- Auto-generated from GitHub releases
- Developer-friendly
- Command-line install

## 📞 Next Steps

1. ✅ **Generate icons** (5 min)
2. ✅ **Update Publisher** in Package.appxmanifest (2 min)
3. ✅ **Build MSIX** with Build-MSIX.ps1 (3 min)
4. ✅ **Take screenshots** (5 min)  
5. ✅ **Submit to Store** (15 min)

**Total time to submit: ~30 minutes!**

## 📚 Additional Resources

- Full README: See detailed README.md files in outputs
- Store metadata: StoreMetadata.md (copy-paste ready)
- Privacy policy: PrivacyPolicy.md
- Quick start guide: QUICKSTART.md

## ✅ You're Ready!

Everything is set up and ready to build. The only things you need to add:
1. Generate 7 icon sizes from your logo
2. Update Publisher name
3. Hit Build!

**Questions? Check the documentation files or open an issue!**

---
**Good luck with your launch! 🚀**
