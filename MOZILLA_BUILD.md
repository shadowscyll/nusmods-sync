# Mozilla reviewer build instructions

Submitted add-on: NUSMods Sync 1.1

## Requirements

- Linux x86_64
- Node.js 24.14.0
- npm 11.9.0

No global packages are required.

## Build

From the root of the extracted source archive, run:

```sh
npm ci
npm run build:firefox
```

The public relay URL is supplied by the included `.env.relay` file. The
unpacked Firefox extension is generated in `dist/firefox`.

For the self-distributed variant with add-on ID
`nusmods-sync-unlisted@accountless-sync.local`, run:

```sh
npm run build:firefox:unlisted
```

To produce an uploadable ZIP from that directory, run:

```sh
node node_modules/web-ext/bin/web-ext.js build \
  --source-dir dist/firefox \
  --artifacts-dir web-ext-artifacts \
  --overwrite-dest
```

## Validation

Run the type checker and automated tests with:

```sh
npm run check
```

Run Mozilla's extension linter with:

```sh
node node_modules/web-ext/bin/web-ext.js lint \
  --source-dir dist/firefox \
  --self-hosted
```

The linter reports two `UNSAFE_VAR_ASSIGNMENT` warnings in the minified React
production runtime. The extension source does not call `innerHTML` or use
React's `dangerouslySetInnerHTML` API.
