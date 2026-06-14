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
- Your Apple ID credentials, and a trusted device to receive the 2FA code on.

## Authentication: how it works & setup

There is **no official Apple API** for Hide My Email. This extension talks to the same
private endpoints that the iCloud.com Mail settings page uses
(`setup.icloud.com` → `pXX-maildomains.icloud.com/v1/hme/*`).

It signs in with your **Apple ID** using Apple's **SRP** handshake (your password is
never sent to Apple in the clear — SRP proves you know it without transmitting it), then
stores a **trust token** so you only need to enter a two-factor code **about once a
month**. On every run it re-authenticates from that trust token to mint a fresh session,
so there are no cookies to manage or re-paste.

### Setup

1. Run either command. On first launch Raycast prompts for preferences.
2. Enter your **Apple ID** (e.g. `you@icloud.com`) and **Password**.
3. The first time, you'll be asked for the **6-digit verification code** Apple pushes to
   your trusted devices. Enter it once; the trust token is saved for ~30 days.
4. Set **Region → China** if you use an `icloud.com.cn` account.

> **Security:** your password is stored only in Raycast's encrypted preferences and used
> solely for Apple's SRP login. The trust token lives in Raycast's local storage. Nothing
> is sent anywhere except Apple.

### SRP credit

The SRP-6a (GSA) implementation is provided by
[`@foxt/js-srp`](https://www.npmjs.com/package/@foxt/js-srp); the login orchestration is
ported from [foxt/icloud.js](https://github.com/foxt/icloud.js) and
[mandarons/icloudpy](https://github.com/mandarons/icloudpy).

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
