# Windows Desktop Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a tested Windows x64 `Setup.exe` that runs Paper Audit Copilot locally and persists each user's data outside the installation directory.

**Architecture:** Refactor the Express entry point into an explicit application/server lifecycle, then host it on an ephemeral loopback port from a locked-down Electron main process. Electron Forge and Squirrel.Windows package the existing Vue build, backend, and production dependencies into an installer while a small release script emits a SHA-256 checksum.

**Tech Stack:** Node.js 24, Electron 44, Electron Forge, Squirrel.Windows, Express 5, Vue 3, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-28-windows-desktop-distribution-design.md`

## Global Constraints

- Target Windows x64 and generate a `Setup.exe` with desktop and Start menu shortcuts.
- Store runtime data beneath Electron's `app.getPath('userData')`, never in the repository or installation directory.
- Bind the desktop HTTP server only to `127.0.0.1` and use an operating-system-assigned port.
- Preserve the existing command-line web server and same-origin `/api` behavior.
- Keep renderer Node integration disabled, context isolation and sandboxing enabled, and block navigation away from the local origin.
- Do not bundle `.env`, `data`, uploaded papers, experiments, test output, Playwright browser downloads, or API keys.
- Do not publish a GitHub Release, add automatic updates, or add code signing in this implementation.

## Review Focus

- Startup failure before a port is assigned must close partially initialized database/server resources and show a native error.
- Application shutdown with active workers must not leave a running Electron or backend process.
- Packaged ASAR resolution must serve `dist/index.html` and start worker modules correctly.
- A second app launch must focus the existing window without starting another database owner.
- Installer upgrades must preserve the Electron user-data directory and existing workspace cookie.

---

### Task 1: Explicit backend lifecycle

**Files:**
- Create: `server/application.js`
- Modify: `server/index.js`
- Create: `tests/application.test.js`

**Interfaces:**
- Produces: `createPaperAuditApplication({ dataDirectory, rootDirectory? })` returning `{ app, start({ host, port }), close() }`; `start` resolves to `{ host, port, origin }`.
- Consumes: existing store, services, route handlers, worker lifecycle, and production `dist` assets.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests named `starts on an ephemeral loopback port with an explicit data directory`, `closes the listener and SQLite database cleanly`, and `rejects a non-loopback desktop host`. Assert `/api/health`, SQLite creation under the supplied directory, connection refusal after close, and rejection of non-loopback host when `desktop: true`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/application.test.js`

Expected: FAIL because `server/application.js` and its exported factory do not exist.

- [ ] **Step 3: Implement the lifecycle factory and thin CLI entry point**

Move application construction and route registration into `createPaperAuditApplication`. Make `start` wait for the listening event and read the actual bound port. Make `close` idempotently stop revisions/reviews, terminate workers, close the listener, then close SQLite. Keep `server/index.js` responsible only for environment parsing, startup logging, signal handlers, and a nonzero exit on startup failure.

- [ ] **Step 4: Verify GREEN and regression coverage**

Run: `node --test tests/application.test.js tests/api.test.js`

Expected: PASS with zero failures and the existing spawned CLI API behavior preserved.

- [ ] **Step 5: Commit**

Run: `git add server/application.js server/index.js tests/application.test.js && git commit -m "refactor: expose backend lifecycle for desktop"`

### Task 2: Secure Electron host

**Files:**
- Create: `desktop/config.js`
- Create: `desktop/main.js`
- Create: `tests/desktop.test.js`

**Interfaces:**
- Consumes: `createPaperAuditApplication` from Task 1.
- Produces: `resolveDesktopDataDirectory(userDataPath)`, `createWindowOptions()`, `isAllowedNavigation(target, origin)`, and the Electron main-process lifecycle.

- [ ] **Step 1: Write failing desktop configuration tests**

Test that the data directory is `<userDataPath>/data`; window options set `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`; only the exact local origin is allowed for in-app navigation; HTTPS links are classified for external opening; HTTP/non-web schemes are denied.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/desktop.test.js`

Expected: FAIL because `desktop/config.js` does not exist.

- [ ] **Step 3: Implement testable configuration helpers**

Export the exact helper interfaces above without importing Electron so Node tests can execute them directly.

- [ ] **Step 4: Verify helper GREEN**

Run: `node --test tests/desktop.test.js`

Expected: PASS with zero failures.

- [ ] **Step 5: Implement Electron main lifecycle**

Acquire the single-instance lock before initializing storage. On ready, resolve user data, start the backend with `{ host: '127.0.0.1', port: 0, desktop: true }`, remove the application menu, create one secure `BrowserWindow`, enforce navigation/window-open policy, and load the returned origin. Focus or recreate the window using standard Windows lifecycle events. On startup failure show `dialog.showErrorBox`; on quit await backend close exactly once.

- [ ] **Step 6: Add source-level lifecycle assertions and run tests**

Extend `tests/desktop.test.js` to assert the main module uses the factory with loopback/ephemeral settings, obtains `app.getPath('userData')`, acquires a single-instance lock, and registers shutdown. Run `node --test tests/desktop.test.js` and expect PASS.

- [ ] **Step 7: Commit**

Run: `git add desktop tests/desktop.test.js && git commit -m "feat: add secure Electron desktop host"`

### Task 3: Windows installer and artifact checksum

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `forge.config.js`
- Create: `scripts/checksum-release.js`
- Create: `tests/packaging.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `desktop/main.js` from Task 2 and the existing `npm run build` output.
- Produces: `npm run desktop:start`, `npm run desktop:package`, `npm run desktop:make`, and `npm run release:checksum -- <artifact>`.

- [ ] **Step 1: Write failing packaging-policy tests**

Assert the package main entry targets `desktop/main.js`; Forge uses Squirrel.Windows for x64; installer metadata requests desktop and Start menu shortcuts; packaged file rules include `dist`, `server`, `shared`, and runtime dependencies while excluding `data`, `.env`, tests, experiments, and reports; the checksum script writes `<artifact>.sha256` containing lowercase SHA-256 and the artifact basename.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/packaging.test.js`

Expected: FAIL because packaging configuration and checksum code do not exist.

- [ ] **Step 3: Add packaging dependencies and scripts**

Install Electron 44, Electron Forge CLI/core, Squirrel.Windows maker, ASAR native-unpack plugin, and `electron-squirrel-startup` using local project npm configuration. Update package metadata and scripts without weakening the existing Node engine requirement.

- [ ] **Step 4: Implement Forge configuration and checksum CLI**

Configure Windows x64 output, application identity/product name, ASAR native unpacking, Squirrel shortcut creation, and a narrow packaged file allowlist. Make checksum generation reject missing/non-file input and write the adjacent checksum file.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/packaging.test.js`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit**

Run: `git add package.json package-lock.json forge.config.js scripts/checksum-release.js tests/packaging.test.js .gitignore && git commit -m "build: add Windows desktop installer"`

### Task 4: Desktop documentation and distributable verification

**Files:**
- Modify: `README.md`
- Create: `docs/desktop-release.md`

**Interfaces:**
- Consumes: all commands and artifact behavior from Tasks 1–3.
- Produces: operator instructions for building, smoke testing, checksumming, and manually attaching artifacts to GitHub Releases.

- [ ] **Step 1: Write the desktop usage and release documentation**

Document installation, local data/backup location, model-provider transmission, unsigned SmartScreen warning, uninstall persistence, build prerequisites, build commands, artifact names, checksum verification, and the explicit rule that publishing is manual and out of scope.

- [ ] **Step 2: Run full source verification**

Run: `npm run build && npm test`

Expected: TypeScript/Vite build succeeds and every Node test passes with zero failures.

- [ ] **Step 3: Build the Windows installer**

Run: `npm run desktop:make`

Expected: Electron Forge exits zero and emits an x64 Squirrel.Windows `Setup.exe` under `out/make`.

- [ ] **Step 4: Generate and verify the checksum**

Run the checksum command against the emitted installer, recompute SHA-256 independently with PowerShell `Get-FileHash`, and assert the two lowercase digests match.

- [ ] **Step 5: Perform desktop smoke verification**

Launch the packaged application, wait for its local health endpoint/window readiness signal, verify its data directory is outside the installation tree, close it, relaunch it, and verify the SQLite file and workspace session persist. If automated installation would mutate the user's machine, stop at packaged-app smoke testing and report installation/uninstall as requiring user-run validation.

- [ ] **Step 6: Commit**

Run: `git add README.md docs/desktop-release.md && git commit -m "docs: add desktop installation and release guide"`

- [ ] **Step 7: Final verification**

Run: `npm run build && npm test && npm run desktop:make`

Expected: all commands exit zero; report exact test counts, installer path, installer size, and SHA-256 path. Do not publish or upload artifacts.
