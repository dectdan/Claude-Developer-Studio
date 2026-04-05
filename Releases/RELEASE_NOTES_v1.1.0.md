## ClaudeDevStudio v1.1.0

First fully self-contained installer. Download, double-click, restart Claude Desktop — done.

### What's New

**Automatic Claude Desktop integration**
The installer now automatically configures Claude Desktop. No manual JSON editing required. If you install Claude Desktop after CDS, right-click the tray icon and choose "Link Claude Desktop..." to connect instantly.

**AI Provider support (Qwen)**
CDS can delegate coding tasks to Qwen3-Coder-480B (480B parameter coding model) and other providers, dramatically reducing Claude token usage during long coding sessions. Configure your own API keys via the tray icon → "Configure AI Keys...". Providers: Together AI, Groq, DeepInfra, Fireworks, OpenRouter. All optional — CDS works fully without them.

**Review Panel**
Built-in localhost review panel for viewing generated code and images without cluttering the chat.

**Voice alerts**
On-machine Kokoro TTS for spoken alerts and status updates — no API cost.

**VS Bridge extension**
Visual Studio 2022 extension (CDS VS Bridge) for live debugger integration. Installs automatically if VS 2022 is detected.

### Installation

1. Download `ClaudeDevStudio-v1.1.0-Setup.exe`
2. Run it — click **Yes** on the UAC prompt (required to install Node.js)
3. Restart Claude Desktop
4. CDS appears in Developer settings — connected

### System Requirements

- Windows 10/11 (64-bit)
- Claude Desktop app
- Node.js — **bundled in installer**, no separate download needed
- .NET 8 Runtime — downloaded automatically if missing
- 600MB disk space

### Notes

- This installer bundles Node.js v22.14.0, Windows App Runtime 1.8, and the Kokoro voice model (310MB) — no internet required after download
- API keys are NOT included — add your own via the tray icon after install
- VS Bridge extension requires Visual Studio 2022 Community/Professional/Enterprise

**Full changelog**: https://github.com/dectdan/Claude-Developer-Studio/compare/v1.0.1...v1.1.0
