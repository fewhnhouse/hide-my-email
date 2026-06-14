# Hide My Email (Raycast)

Create, search and manage your iCloud **Hide My Email** addresses straight from Raycast —
no more digging four levels deep into Settings.

## Commands

- **Search Hide My Email** — fuzzy-search all your addresses by address, label or note.
  Copy/paste an address, edit its label & note, deactivate/reactivate, or delete.
- **Create Hide My Email** — generate a fresh address, give it a label, reserve it, and
  it's copied to your clipboard.

## Requirements

- An **iCloud+** subscription (Hide My Email is part of iCloud+).
- A logged-in `icloud.com` session in your browser to copy a cookie from (see below).

## Authentication: how it works & setup

There is **no official Apple API** for Hide My Email. This extension talks to the same
private endpoints that the iCloud.com Mail settings page uses
(`setup.icloud.com` → `pXX-maildomains.icloud.com/v1/hme/*`).

Rather than re-implementing Apple's fragile SRP login + 2FA flow (the approach that
repeatedly breaks other tools), this extension **reuses your existing browser session**
by replaying its cookies. You paste them in once; refresh when they expire.

### Getting your cookie

1. Open <https://www.icloud.com> in your browser and sign in.
2. Open **Developer Tools → Network**.
3. Click **Mail**, then open its **Settings → Hide My Email** so a request to
   `*maildomains.icloud.com` or `setup.icloud.com` appears.
4. Click that request → **Headers** → find the **`Cookie`** request header → copy its
   **entire value**.
5. In Raycast, run either command once; it will prompt for preferences. Paste the value
   into **iCloud Cookie**. (At minimum it must contain the `X-APPLE-WEBAUTH-*` and
   `X-APPLE-DS-WEB-SESSION-TOKEN` cookies.)

> **Heads up:** these cookies grant access to your iCloud account. They're stored in
> Raycast's encrypted preferences and sent only to Apple. They expire periodically — when
> you start seeing "session expired" errors, repeat the steps above to refresh.

Set **Region → China** if you use an `icloud.com.cn` account.

## Development

```sh
npm install
npm run dev      # opens the extension in Raycast in development mode
npm run build
npm run lint
```

## Limitations

- Built on undocumented endpoints — Apple can change them at any time.
- iCloud caps accounts at ~750 addresses.
- An address must be **deactivated** before it can be permanently **deleted** (Apple's rule).

## Credits

API surface ported from
[dedoussis/icloud-hide-my-email-browser-extension](https://github.com/dedoussis/icloud-hide-my-email-browser-extension).
