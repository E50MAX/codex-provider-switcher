# Secure publishing checklist

## Before the first release

1. Create a Visual Studio Marketplace publisher with multi-factor authentication enabled on the backing Microsoft/Azure account.
2. Confirm that the `publisher` value in `package.json` matches the final Marketplace publisher ID.
3. Add the final public repository, homepage, and issue URLs to `package.json`.
4. Enable private vulnerability reporting and branch protection on the source repository.
5. Do not paste a Marketplace token, GitHub token, API Key, or `auth.json` into an issue, commit, workflow file, or chat.

## Build gate

Run from a clean checkout:

```powershell
npm ci
npm audit
npm run verify
npm run package
```

Inspect the generated VSIX before upload. It must contain only the files listed by the `files` allowlist in `package.json`.

## Recommended distribution

Publish the extension through Visual Studio Marketplace so VS Code can verify the Marketplace signature and deliver updates. Keep the source repository public for review. A GitHub release may mirror the VSIX, but users should prefer the Marketplace build.

For the first release, manual upload through the Marketplace publisher management page avoids putting a long-lived publishing credential on a development machine. If automated publishing is added later, follow the current official VS Code guidance and use a narrowly scoped secret or Microsoft Entra ID. Never commit publishing credentials.

## Account hardening

- Enable multi-factor authentication.
- Use a dedicated publisher identity where practical.
- Grant the minimum publishing scope.
- Rotate or revoke publishing credentials after suspected exposure.
- Review Marketplace acquisition and unusual-activity reports.
- Never disable VS Code extension signature verification to work around a failed release.
