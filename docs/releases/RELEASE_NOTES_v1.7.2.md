# ClaudeDevStudio v1.7.2

A new icon. Nothing about your memory or how CDS works changes.

## Changed

- **New ClaudeDevStudio icon** everywhere it shows: the installer and uninstaller, the tray icon, the Dashboard's program file and taskbar button, and the Dashboard's tiles. The icon fills its square with transparent rounded corners, without the old white border, and comes in every size Windows asks for (16 to 256 pixels).

## Fixed

- **The Start menu shortcut and the Startup apps list showed Windows' generic program icon.** The tray app's program file now carries the icon itself (before, only the icon in the notification area had it).
- **Apps & Features (Installed apps) showed no icon for ClaudeDevStudio.** The installer now registers the icon there.

## Upgrading

Run the installer over v1.7.1. It backs up your whole memory store first, as before. Windows may keep showing the old icon on the Start menu for a while until its icon cache refreshes; signing out and back in clears it.
