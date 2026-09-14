---
name: run
description: Launch this app's Next.js dev server locally and verify it's up. Use whenever asked to run, start, or check the dividend_app project locally.
---

# Running dividend_app locally

This repo is checked out in two places on this machine:

- `C:\dev\my-dividend-app` — **use this one.** Plain filesystem path, works reliably.
- `...\OneDrive\デスクトップ\development\dividend_app` — **do not run here.** OneDrive sync corrupts native binaries inside `node_modules` (e.g. `@next/swc-win32-x64-msvc\next-swc.win32-x64-msvc.node`), which makes `next dev` / `next build` segfault (Node crashes with exit code 139/`Segmentation fault`, or PowerShell reports exit code 5 with no useful output). If asked to run the app and only the OneDrive copy is available, warn the user and suggest cloning/copying it to a non-OneDrive path (e.g. `C:\dev\...`) first.

## Steps

1. `cd C:\dev\my-dividend-app`
2. `npm install` (only if `node_modules` is missing or `package-lock.json` changed)
3. `npm run dev`
4. Open http://localhost:3000

## Known issue: stale `.next` cache

After moving/cloning the project or switching Node versions, the first `next dev` run can throw:

```
⨯ SyntaxError: Unexpected end of JSON input
    at JSON.parse (<anonymous>) {
  page: '/'
}
```

This is a corrupted/incomplete file inside the `.next` build cache, not an application bug (there's no direct `JSON.parse`/`.json()` call in the `/` route). Fix:

1. Stop the dev server (Ctrl+C)
2. Delete the `.next` folder: `rm -rf .next` (or `Remove-Item -Recurse -Force .next` in PowerShell)
3. Restart: `npm run dev`
