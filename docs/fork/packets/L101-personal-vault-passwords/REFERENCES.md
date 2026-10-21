# L101 references

## Existing Loom

- [L27 Utilities](../L27-utilities/): existing selected password tool and its policy/entry points.
- `apps/web/src/fork/utilities/tools/generate.ts`: original password consumer.
- `apps/web/src/fork/utilities/runtime.ts`: cryptographic browser byte source.
- `apps/mobile/src/features/cloud/dpop.ts`: existing Expo Crypto adapter pattern.
- `apps/web/src/hooks/useCopyToClipboard.ts`: established browser/desktop clipboard behavior.
- [Personal Vault direction](../LOOM-PERSONAL-VAULT.md): custody and future feature scope.

## Official platform references

- [Web Crypto getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues): cryptographic bytes and request quota.
- [Expo Crypto](https://docs.expo.dev/versions/latest/sdk/crypto/): native random-byte adapter.
- [Expo Clipboard](https://docs.expo.dev/versions/latest/sdk/clipboard/): explicit system clipboard writes.

No external code, assets or new packages are imported by this packet.
