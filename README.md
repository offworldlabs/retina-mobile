# RETINA mobile

Native iOS and Android app for the RETINA network, built with Expo (SDK 58, React Native 0.88, expo-router, TypeScript).

## Requirements

- Node 22
- Android: the Android SDK, a JDK that Gradle supports, and an emulator image
- iOS: macOS with Xcode and an iOS Simulator runtime
- A retina-server checkout for the local backend and for `npm run api:pull`

For Android, set `ANDROID_HOME` to the SDK and `JAVA_HOME` to a JDK that Gradle accepts. A system Java that is newer than Gradle supports fails the build; the JDK bundled with Android Studio works. Create an AVD once and start it before `npm run android`.

## Setup

```sh
npm ci
```

## Scripts

| Script                 | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `npm start`            | Metro on port 18421 for the development build                 |
| `npm run android`      | Build and run the development build on an Android emulator    |
| `npm run ios`          | Build and run the development build on the iOS Simulator      |
| `npm run lint`         | ESLint, no warnings allowed                                   |
| `npm run format`       | Prettier, rewrites files                                      |
| `npm run format:check` | Prettier, check only                                          |
| `npm run typecheck`    | `tsc --noEmit`                                                |
| `npm test`             | Jest (jest-expo)                                              |
| `npm run doctor`       | `expo-doctor`                                                 |
| `npm run native:clean` | Regenerate `ios/` and `android/` with `expo prebuild --clean` |
| `npm run api:pull`     | Dump the OpenAPI snapshot from a retina-server checkout       |
| `npm run api:types`    | Regenerate the API types from the snapshot                    |
| `npm run api:check`    | Fail if the committed types differ from the snapshot          |

## Environments

`APP_ENV` selects the environment in `app.config.ts`: `development` (default), `preview` or `production`. Any other value stops the config with an error. EAS profiles set it per build.

| `APP_ENV`     | API base URL                                                           |
| ------------- | ---------------------------------------------------------------------- |
| `development` | iOS `http://localhost:18422`, Android emulator `http://10.0.2.2:18422` |
| `preview`     | `https://test-app.retina.fm`                                           |
| `production`  | `https://app.retina.fm`                                                |

The preview and production hosts are config values only. Nothing in the repo or in development talks to them.

In `development`, `RETINA_API_URL` replaces the URL on both platforms, for example to reach a backend on another machine or port. It is ignored in the other environments.

## Run on simulators against a local retina-server

Run these in a retina-server checkout, in `backend/`:

```sh
RETINA_ENV=dev .venv/bin/python -m alembic upgrade head
RETINA_ENV=dev AUTH_ALLOW_ANONYMOUS_ADMIN=1 SYNTHETIC_FLEET_ENABLED=1 RADAR_TCP_PORT=18423 \
  .venv/bin/uvicorn main:app --port 18422
```

The Map tab lists the network's nodes from the public `GET /api/radar/leaderboard`. With an empty database the list is empty. For data, start the synthetic fleet with the `retina_simulation` package from the same checkout, in a separate working directory because it writes files. The package is installed only in that checkout's `backend/.venv`, so call that interpreter:

```sh
RS=/path/to/retina-server
"$RS/backend/.venv/bin/python" -m retina_simulation.generator --nodes 30 --metro gvl --seed 42 --layout scatter --n-cluster 20 --output fleet.json
"$RS/backend/.venv/bin/python" -m retina_simulation.orchestrator --config fleet.json --metro gvl --port 18423 --mode adsb --interval 0.5 --validation-url http://localhost:18422
```

Then, in this repo:

```sh
npm run android   # boots the app on the running emulator
npm run ios       # boots the app on the iOS Simulator
```

Both commands build the native project on first run and start Metro on port 18421. `npm start` runs Metro alone for a build that is already installed.

## API types

`openapi/retina-server.json` is a snapshot of the backend's OpenAPI document, `openapi/source.json` records the retina-server commit it came from, and `src/api/schema.gen.ts` is generated from the snapshot. All three are committed.

```sh
npm run api:pull -- /path/to/retina-server   # new snapshot, then regenerate types
npm run api:types                            # regenerate types from the snapshot
npm run api:check                            # used by CI
```

`api:pull` runs the dump with the backend venv of the given checkout, so that venv has to exist.

## Layout

- `src/app` routes (expo-router)
- `src/api` API client, errors, TanStack Query setup, generated types
- `src/config` environment and base URL
- `src/theme` colors, type scale, spacing
- `src/components` shared components
- `src/features` screens' logic, one folder per feature
- `scripts` and `openapi` API snapshot tooling

## Native folders

`ios/` and `android/` are generated by `expo prebuild` (continuous native generation) and are not committed. `npm run android` and `npm run ios` create them when missing. `npm run native:clean` rebuilds them from scratch.

## Builds

`eas.json` has `development`, `preview` and `production` profiles, each setting `APP_ENV`. No cloud builds are set up yet.

The bundle id and Android package are `fm.retina.app`, a placeholder. It is set once, as `APP_ID` in `app.config.ts`. The URL scheme is `retina`.
