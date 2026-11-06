# @snf/qa-bot-core Publishing Guide

This document outlines the simplified process for publishing the QA Bot Core package to npm.

## Why the `build/` directory is committed to git (read this first)

Unlike most projects, **the compiled `build/` directory is committed to git on
purpose** — do not gitignore it or assume it's stale build output.

The reason is our **primary CDN is jsDelivr serving files directly from the
GitHub repo** at a version tag:

```
https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v${version}/build/static/js/main.js
https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v${version}/build/static/js/453.chunk.js
https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v${version}/build/static/css/main.css
```

Every site that embeds the bot via jsDelivr loads these exact committed files
from the **tagged release commit** (`@v${version}`). The CDN never serves
`build/` from a feature branch or from `main` between releases — only from tags.
So the rule is:

- **The tagged release commit must contain a fresh `build/` that matches its
  source.** Regenerate (`npm run build`) and commit `build/` as part of the
  version-bump / release step, then tag. Stale or missing `build/` files at a
  tag mean the CDN serves stale or broken code to every embedder.
- **Feature PRs should stay source-only.** A source change dirties `build/`,
  but committing minified artifacts in feature PRs is unreviewable noise and a
  constant source of merge conflicts. Revert the `build/` changes in feature
  work; it gets regenerated once, cleanly, at release.
- Build with the **same toolchain as CI** (see `netlify.toml` for the Node
  version) so the tagged artifacts match what the deploy produces. Building on
  a different Node version can produce non-identical output.

Two different output directories, two different purposes:

| Dir | Build command | Tracked in git? | Consumed by |
|-----|---------------|-----------------|-------------|
| `build/` | `npm run build` (CRA) | **Yes — committed** | jsDelivr CDN (`/gh/...@vX/build/...`) |
| `dist/` | `npm run build:lib` (rollup) | No — gitignored | npm / unpkg (`@snf/qa-bot-core`) |

`dist/` is regenerated automatically at publish time via `prepublishOnly`, so it
does not need to be committed. `build/` does.

## Version Management

In our project, version management is critical because of our CDN delivery system:

- **Version numbers must be incremented**: Never reuse a version that's been tagged
- **CDN links depend on version tags**: Our jsdelivr CDN links reference specific git tags
- **Always check existing tags before versioning**: To avoid conflicts with existing CDN links

Our CDN links follow this pattern:
```
https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v${version}/build/static/js/main.js
https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v${version}/build/static/js/453.chunk.js
```

✅ **Note**: Thanks to our `config-overrides.js` file, chunk filenames are consistent across builds. The `453.chunk.js` filename is stable and predictable.

### Checking Existing Versions

Before updating a version, always check existing tags to avoid conflicts:

```bash
# List all version tags
git tag -l "v*"

# Or check a specific version
git tag -l "v0.1.0"
```

## Setup

1. Ensure you have npm account credentials for the `snf` organization
   - Username: `yournpmusername`
   - Organization: `snf`

2. Log in to npm:
   ```bash
   npm login
   ```

## Standard Release Process

This is the main workflow for releasing new versions of the package.

### 1. Feature Development

```bash
# Create feature branch from main
git checkout -b feature/my-feature main

# Make your changes, commit them
# ...
# DO NOT update version numbers yet - this happens after merge
```

### 2. Test the Package (Optional)

```bash
# Test the package locally (without version changes)
npm pack
tar -tf @snf/qa-bot-core-*.tgz

# Clean up the test file
rm @snf/qa-bot-core-*.tgz
```

### 3. Open Pull Request

- Create PR from `feature/my-feature` to `main`
- Include description of changes
- Get code review and approval
- **Note**: PR should NOT include version bumps

### 4. Merge to Main

Once PR is approved, merge it to main **on GitHub** (using the GitHub web interface). Then proceed with the release.

### 5. Prepare Release (Post-Merge)

```bash
# Switch to main and pull latest changes (including your merged PR)
git checkout main
git pull origin main

# Check existing versions before updating
git tag -l "v*"

# Update version in TWO places (manually edit):
# 1. package.json - Example: "0.1.1"
# 2. src/utils/logger.ts - Update LIB_VERSION constant to match
# IMPORTANT: Choose a NEW version that doesn't have an existing git tag
# This is necessary for our CDN links to work correctly

# Sync package-lock.json with new version
npm install

# Build the library and app for both npm and CDN delivery
npm run build:lib
npm run build

# Chunk filename is consistent (453.chunk.js) thanks to config-overrides.js
# but you can verify with: ls build/static/js/*.chunk.js

# Commit the version change and builds
git add .
git commit -am "Bump version to 0.1.1"

# Push the version bump to main
git push origin main
```

### 6. Create Git Tag and GitHub Release

```bash
# Create git tag and push it (version should already be committed)
git tag -a v0.1.1 -m "Release version 0.1.1"  # Match your actual version
git push origin v0.1.1

# Create GitHub release
```

#### GitHub Release Steps:
- Go to: https://github.com/connectci-platform/qa-bot-core/releases/new
- Select the tag you just created (v0.1.1)
- Add a title and description
- Click "Publish release"

### 7. Publish to npm

```bash
# Publish directly from main (ensure you're on main with latest changes)
# Note: prepublishOnly script will automatically run 'npm run build:lib'

# If you have 2FA enabled on npm (recommended):
# 1. Get your 6-digit code from your authenticator app
# 2. Run the publish command with --otp flag:
npm publish --access public --otp=123456

# If you don't have 2FA enabled:
npm publish --access public
```

**Why we publish from main:**
- The `"files"` field in package.json already controls what gets published
- `prepublishOnly` script ensures the library is built before publishing
- Simpler workflow with single source of truth

**Note**: Replace `123456` with your actual authenticator code. OTP codes expire every 30 seconds, so run the command quickly after getting the code.

## Debug Release Workflow

For quick debug releases during development (publishes to npm only, no git tags or GitHub releases):

```bash
# From any local branch
# Update version (e.g., 0.1.0-debug.0 to 0.1.0-debug.1)
npm version 0.1.0-debug.1

# Build the library
npm run build:lib

# Publish with debug tag (add --otp=code if you have 2FA enabled)
npm publish --tag debug --access public
```

This workflow is useful for:
- Quick iterations during development
- Testing specific versions in integration environments
- Publishing debug versions without affecting the main release process

## Alternative: npm-release Branch (Not Recommended)

We don't use an npm-release branch because:
- Our `"files"` field in package.json already controls what gets published
- `prepublishOnly` script handles build automation
- Main branch publishing is simpler and less error-prone

If you ever need to use a release branch, you would:
```bash
git checkout -b npm-release main
git merge main  # to sync
npm publish --access public
```

## CDN Usage

Our project uses two CDN systems:

### 1. jsdelivr CDN (Primary CDN)

This CDN pulls directly from our GitHub repository based on git tags:

```
https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v0.1.0/build/static/js/main.js
```

The version number in these URLs must match git tags in our repository. Never reuse a version number that already has a tag to avoid breaking existing CDN links.

A complete jsDelivr implementation typically requires three files:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v0.1.0/build/static/css/main.css">
<div id="qa-bot"></div>
<script src="https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v0.1.0/build/static/js/main.js"></script>
<script src="https://cdn.jsdelivr.net/gh/connectci-platform/qa-bot-core@v0.1.0/build/static/js/453.chunk.js"></script>
```

**Important:** When updating the package:
1. Make sure these file paths remain consistent
2. Test all jsDelivr URLs after updating
3. Because of `config-overrides.js`, chunk filenames are stable (`453.chunk.js` remains consistent across builds)

### 2. unpkg CDN (npm-based, Secondary)

After publishing to npm, the package will also be available via unpkg:

```
https://unpkg.com/@snf/qa-bot-core@0.1.0/dist/qa-bot-core.standalone.js
```

### 3. Using the Published Package

After the package is published to npm, users can install and use it in their projects.

```bash
# Install the package
npm install @snf/qa-bot-core
```

For more detailed usage instructions and examples, refer to the README.md file.

## AI Assistant Notes

This workflow is designed to be clear and actionable for AI assistants. Key points:

- **Version bump timing**: Always happens AFTER PR merge, on main branch
- **Feature PRs**: Should NOT include version bumps - focus on feature changes only
- **Two version locations**: Update both `package.json` AND `src/utils/logger.ts` (LIB_VERSION constant)
- Always check existing git tags before choosing a version number
- Build commands are: `npm run build:lib && npm run build`
- The process maintains both npm packages and CDN links
- Debug releases use the `--tag debug` flag and don't create git tags
- Clean up temporary files (like .tgz from npm pack) after testing
- **Predictable filenames**: Our `config-overrides.js` ensures consistent chunk names (`453.chunk.js`) across builds for reliable CDN links
- **Flexible for future needs**: Publishing from main keeps options open for release channels via npm tags if needed later
- **2FA Authentication**: User has 2FA enabled on npm, so all publish commands need `--otp=code` flag with 6-digit authenticator code

### If Version Bump Gets Missed
If a PR is merged without version bump (old workflow), simply:
1. Update version on main after merge
2. Build and commit
3. Proceed with tagging and release
This is actually the preferred approach.