# Changelog

All notable changes to this plugin are documented in this file.

## [0.1.0] - 2026-08-16

- Initial release of the turn-complete notification plugin.
- Notifications card in Settings → General with enable / sound / tone options.
- Host-side macOS system notification via `terminal-notifier`, so turns notify even when the Web GUI is closed.
- Notification title carries the session name and the body carries the assistant reply (both truncated when long).
- Optional synthesized chime (soft / crisp / low) played via `afplay`, matching the in-card Web Audio preview.
- Browser-side fallback monitor (localStorage) while the host bundle is not loaded.
