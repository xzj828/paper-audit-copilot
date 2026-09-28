# Windows Desktop Distribution Design

## Goal

Distribute Paper Audit Copilot as a Windows x64 `Setup.exe` through GitHub Releases. End users install and launch the application without installing Node.js, and all application data remains on their own computer rather than the author's server.

## Scope

The first desktop release includes an installation wizard, Start menu entry, desktop shortcut, uninstall support, persistent local data, and a production Electron window. It does not include automatic updates, Windows code signing, cloud synchronization, user accounts, or publishing a GitHub Release.

## Architecture

Electron 44 hosts the existing Vue frontend and Express backend. Electron's main process starts the backend on an operating-system-assigned loopback port and opens a `BrowserWindow` at that local origin. The renderer keeps using the existing same-origin `/api` contract, so the web application requires no desktop-specific API transport.

The backend is refactored from an import-time executable into a factory with explicit `start` and `close` lifecycle operations. The existing command-line entry point continues to call that factory, preserving web/server development and production use.

Electron Forge packages the application, and the Squirrel.Windows maker produces the Windows x64 installer. Electron 44 is required because its embedded Node.js 24 runtime supports the project's `node:sqlite` dependency.

## Local data and privacy

The desktop main process supplies `DATA_DIR` from Electron's `app.getPath('userData')`, with application data stored under its `data` child directory. On a normal Windows installation this resolves beneath `%APPDATA%` or `%LOCALAPPDATA%`, depending on Electron's platform path. The implementation must use Electron's returned path rather than constructing a username-dependent path manually.

The SQLite database, uploaded PDF/DOCX files, settings, reports, encrypted model credentials, and encryption key remain outside the installed application directory. Installing an update must not overwrite them. Normal uninstall removes the application but does not intentionally delete user data.

The existing anonymous workspace cookie remains enabled and persists in Electron's default session. It isolates the active workspace inside the desktop profile, although the device-level data directory is the primary isolation boundary. Clearing Electron application data loses the cookie and may make an existing anonymous workspace unreachable.

Model-backed analysis still sends the configured request content to the model provider selected by the user. The desktop packaging must not bundle API keys, `.env` files, development databases, uploaded papers, experiment outputs, or test artifacts.

## Runtime lifecycle

Only one application instance may run per Windows user profile. A second launch focuses the existing window.

At startup, the application:

1. resolves and creates the user data directory;
2. starts the Express application on `127.0.0.1` with port `0`;
3. waits for the HTTP server to report its assigned port;
4. creates the production browser window and loads that origin.

If startup fails, the user receives a native error dialog and the application exits without opening a broken window.

At shutdown, Electron requests the backend to stop accepting connections, cancels in-flight review and revision work, terminates parser workers, closes SQLite, and then exits. Window close behavior follows normal Windows conventions.

## Security

The HTTP server binds only to `127.0.0.1`; no LAN or public interface is allowed in desktop mode. The assigned port is ephemeral to avoid collisions.

The browser window enables context isolation and sandboxing and disables renderer Node.js integration. It has no preload bridge in the first release because the renderer needs only HTTP APIs. Navigation outside the local application origin is blocked. New-window requests are denied; explicitly allowed HTTPS links may open in the user's default browser.

Production developer tools are not exposed through application menus. The existing same-origin mutation check remains active.

## Packaging

Electron Forge packages only runtime files needed by the built Vue application, server, shared rules, and production dependencies. Native dependencies are rebuilt for Electron's ABI and unpacked from ASAR where required. Chromium binaries downloaded by Playwright are not bundled in the first release; PDF export must detect their absence and show the existing actionable error rather than silently failing.

Squirrel.Windows produces a versioned installer named like `PaperAuditCopilot-Setup-0.1.0.exe`. Installation creates Start menu and desktop shortcuts. The build also emits a SHA-256 checksum file suitable for attaching to a GitHub Release.

The first release is unsigned. Documentation must clearly warn that Windows SmartScreen may display an unknown-publisher prompt. Code signing and automatic updates are deferred.

## Testing and acceptance

Automated tests cover:

- resolving a caller-supplied data directory without falling back to the repository `data` directory;
- starting on an ephemeral loopback port and serving `/api/health`;
- closing the server and SQLite cleanly;
- rejecting non-loopback desktop host configuration;
- Electron window security preferences and navigation policy through testable configuration helpers;
- packaging metadata excluding private/local data.

Verification requires the existing build and Node test suite, an Electron packaging run, creation of a Squirrel.Windows `Setup.exe`, checksum generation, installation on Windows, first launch, data creation under Electron user data, restart persistence, and uninstall behavior. End-to-end browser tests remain responsible for the existing web flow; a short desktop smoke test covers process startup and window loading.

## Release workflow

The repository produces release artifacts locally first. Uploading artifacts or creating a GitHub Release is a separate external action and requires explicit confirmation once the installer has been verified. The release notes must state Windows architecture support, local data location, model-provider data transfer, unsigned-installer warning, backup expectations, and the SHA-256 checksum.
