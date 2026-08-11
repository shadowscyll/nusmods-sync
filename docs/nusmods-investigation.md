# NUSMods persistence and integration investigation

Investigation date: 10 August 2026

Upstream: [`nusmodifications/nusmods`](https://github.com/nusmodifications/nusmods), current `master`

Scope: the existing timetable builder at `https://nusmods.com/timetable`. This report describes the upstream code as inspected; NUSMods itself was not modified.

## Executive summary

NUSMods keeps timetable data in a Redux `timetables` slice and persists that slice with `redux-persist`. In Chrome, `redux-persist/lib/storage` uses the page origin's `localStorage`. The resulting browser key is:

```text
persist:timetables
```

There is no IndexedDB persistence for timetable selections. The normal timetable URL stores the displayed semester in its path, but ordinary edits do not continuously update URL query state. NUSMods generates a portable share URL only when requested; that URL contains module codes and lesson selections and is parsed through NUSMods' own validation/import path.

For NUSMods Sync, the preferred integration is therefore:

1. Read and validate `localStorage["persist:timetables"]` from a content script running only on NUSMods.
2. Normalize only the selected academic year, semester, modules, lesson selections, TA flags, and optionally hidden flags.
3. Detect changes by comparing the exact serialized `persist:timetables` value with a debounced previous value. A one-second lightweight check is less invasive than patching NUSMods or scraping the DOM; unchanged values cause no parsing or extension writes.
4. Restore through a generated native NUSMods `/timetable/<semester>/share?...` URL. NUSMods then loads current module data, deserializes and validates the selections, displays a read-only preview, and requires its own Import confirmation before replacing the saved timetable.

Directly writing `persist:timetables` while NUSMods is open is not recommended: it bypasses upstream validation, races the live Redux persistor, depends on redux-persist's internal encoding, and can be overwritten by the running page.

## 1. Persistence mechanism

### Redux and localStorage

`website/src/reducers/index.ts` constructs the persisted timetable reducer:

```ts
const timetables = persistReducer('timetables', timetablesReducer, timetablesPersistConfig);
```

`website/src/storage/persistReducer.ts` wraps `redux-persist`'s `persistReducer` and imports:

```ts
import storage from 'redux-persist/lib/storage';
```

It supplies `key: 'timetables'` and this storage adapter to redux-persist. The browser storage adapter prefixes persisted reducer keys with `persist:`, producing `persist:timetables` in NUSMods' `localStorage`.

`website/src/bootstrapping/configure-store.ts`, function `configureStore()`, creates the Redux store and starts persistence with:

```ts
const persistor = persistStore(store, undefined, () => {
  initStateWithPrevTab(store);
});
```

The same function removes the obsolete pre-redux-persist key `reduxState` during startup. The helper in `website/src/storage/localStorage.ts`, `getLocalStorage()`, returns `window.localStorage` when usable and otherwise returns an in-memory shim. In the shim case, data cannot survive a reload and an extension cannot provide reliable automatic capture from page storage; this should be surfaced as an integration error.

### Other state channels

- **IndexedDB:** not used for timetable selection persistence.
- **URL path:** `/timetable/:semester?/:action?` identifies the displayed semester and optional `share` action.
- **URL query:** only a portable snapshot for shared/imported timetables; it is not the normal live persistence channel.
- **Cross-tab state:** `stateSyncMiddleware` and `initStateWithPrevTab()` synchronize Redux state between open tabs. This is separate from cross-device persistence.
- **DOM:** a rendered projection of state, not the persistence source. It should not be scraped.

## 2. Exact persisted key and data structure

`website/src/types/reducers.ts` defines `TimetablesState`:

```ts
type TimetablesState = {
  readonly lessons: TimetableConfig;
  readonly colors: SemesterColorMap;
  readonly hidden: HiddenModulesMap;
  readonly ta: TaModulesMap;
  readonly academicYear: string;
  readonly archive: {
    [key: string]: TimetableConfig | TimetableConfigV2 | TimetableConfigV1;
  };
};
```

The current default in `website/src/reducers/timetables.ts`, `defaultTimetableState`, is:

```ts
{
  lessons: {},
  colors: {},
  hidden: {},
  ta: {},
  academicYear: config.academicYear,
  archive: {},
}
```

`persistConfig.version` is `2`. Its `stateReconciler` compares the inbound `academicYear` with the current configured year. When they differ, it starts from current defaults and archives the inbound `lessons` under `archive[inbound.academicYear]`.

The conceptual decoded value of `persist:timetables` is:

```ts
{
  lessons: {
    [semester: number]: {
      [moduleCode: string]: {
        [lessonType: string]: [classNo: string] | lessonIds: string[];
      };
    };
  };
  colors: {
    [semester: number]: { [moduleCode: string]: number };
  };
  hidden: {
    [semester: number]: string[];
  };
  ta: {
    [semester: number]: string[];
  };
  academicYear: string;
  archive: { [academicYear: string]: TimetableConfig };
  _persist: { version: number; rehydrated: boolean };
}
```

The physical localStorage value has redux-persist's nested serialization: the outer value is JSON, and each persisted field in that object is itself a JSON string. A reader must parse the outer object, then parse known fields individually. It must reject malformed, missing, or unexpected types rather than treating them as an empty timetable.

## 3. Module and class-selection representation

`website/src/types/timetables.ts` defines the current structures:

```ts
type ModuleLessonConfig = {
  [lessonType: LessonType]: [ClassNo] | LessonId[];
};

type SemTimetableConfig = {
  [moduleCode: ModuleCode]: ModuleLessonConfig;
};

type TimetableConfig = {
  [semester: Semester]: SemTimetableConfig;
};
```

Consequences:

- A module is selected when its module code exists in `lessons[semester]`.
- For an ordinary student module, each lesson type maps to a one-element tuple containing its selected `ClassNo`, for example:

  ```json
  {
    "CS2103T": {
      "Lecture": ["1"],
      "Tutorial": ["03"]
    }
  }
  ```

- TA-mode modules may select multiple concrete lessons. Their lesson types map to `LessonId[]`, and the module code also appears in `ta[semester]`.
- A `LessonId` is a serialized lesson identity generated by `serializeLessonDetails()` in `website/src/utils/timetables/lessonId.ts`. It preserves the concrete lesson details needed for multiple selections; it must remain opaque to the extension rather than being reduced to a class number.
- `hidden[semester]` contains selected module codes hidden from timetable rendering.
- `colors[semester]` is presentation metadata. It is not required to reproduce module/class selection and is not carried by the current share-link builder.

Older persisted representations (`TimetableConfigV1` and `TimetableConfigV2`) exist only for migration. Current reads must either accept only the current representation or explicitly migrate older schemas; they must not guess based solely on array contents.

## 4. Semester and academic year

### Semester

`website/src/views/routes/Routes.tsx` defines:

```tsx
<Route path="/timetable/:semester?/:action?" component={TimetableContainer} />
```

`website/src/views/routes/paths.ts` builds a mapping from numeric `Semester` values to kebab-cased configured short semester names. Relevant functions are:

- `timetablePage(semester)`
- `semesterForTimetablePage(semStr)`
- `timetableShare(...)`

In `website/src/views/timetable/TimetableContainer.tsx`:

- `semesterForTimetablePage(params.semester)` resolves the path.
- `TimetableHeader.handleSelectSemester()` dispatches `selectSemester(newSemester)` and calls `history.push(timetablePage(newSemester))`.
- `app.activeSemester` is non-persisted UI state, initialized from `config.semester` in `website/src/reducers/app.ts`.

Thus the semester is represented twice for different purposes:

- As the key in `timetables.lessons`, `colors`, `hidden`, and `ta`.
- In the timetable URL path for the currently displayed semester.

The current configured route tokens are exact and finite:

| Semester | Path token |
| --- | --- |
| 1 | `sem-1` |
| 2 | `sem-2` |
| 3 | `st-i` |
| 4 | `st-ii` |

### Academic year

The live academic year is the string `timetables.academicYear`, sourced from `config.academicYear`. It is not included in the current share URL. Share imports are interpreted against the academic year deployed by the NUSMods site and the module data currently loaded for that semester.

NUSMods Sync must include `academicYear` in its normalized record and block automatic application when it differs from the current NUSMods persisted/configured academic year. A mismatch should be shown to the user; it must not be silently coerced.

## 5. Code paths when the timetable changes

### Adding a module

1. `TimetableContent.addModule()` in `website/src/views/timetable/TimetableContent.tsx` calls the connected `addModule` action.
2. `addModule()` in `website/src/actions/timetables.ts` is a thunk. It dispatches `fetchModule(moduleCode)`.
3. Once module data is available, it calls `getModuleLessonMap()` and `randomModuleLessonConfig()`.
4. It dispatches `Internal.addModule(semester, moduleCode, moduleLessonConfig)`, action type `ADD_MODULE`.
5. `timetables()` in `website/src/reducers/timetables.ts` routes the action through `semTimetable()`, `semColors()`, `semHiddenModules()`, and `semTaModules()`.
6. `semTimetable()` writes `lessons[semester][moduleCode]`; `semColors()` assigns a color.
7. The Redux store updates. redux-persist observes the persisted reducer update and writes `persist:timetables` asynchronously.

### Changing lecture/tutorial/lab or another lesson type

1. The first cell interaction runs `TimetableContent.modifyCell()` and dispatches `modifyLesson()`. This only sets non-persisted `app.activeLesson`.
2. Choosing the replacement calls:
   - `changeLesson()` for a normal one-class selection, or
   - `addLesson()` / `removeLesson()` for TA-mode concrete lesson selections.
3. `timetables()` routes these actions to `semTimetable()` and then `moduleLessonConfig()`.
4. `moduleLessonConfig()` replaces, adds, or removes `lessonIds` at `lessons[semester][moduleCode][lessonType]`.
5. `app()` clears `activeLesson` for `CHANGE_LESSON`, `ADD_LESSON`, or `REMOVE_LESSON`.
6. redux-persist writes the new persisted slice.

### Other meaningful changes

- Remove module: `removeModule()` → `REMOVE_MODULE` → `semTimetable()` removes the module and related color/hidden/TA entries.
- Reset: `resetTimetable()` → `RESET_TIMETABLE` → resets all four maps for the semester.
- Hide/show: `hideLessonInTimetable()` / `showLessonInTimetable()` → updates `hidden[semester]`.
- TA mode: `enableTaModule()` / `disableTaModule()` → `ADD_TA_MODULE` / `REMOVE_TA_MODULE` → updates both lesson configuration and `ta[semester]`.
- Imported timetable: `setTimetable()` validates module codes, then dispatches `Internal.setTimetable()` → `SET_TIMETABLE`.

No upstream application-level "timetable changed" DOM event is emitted. The stable observable boundary available to an extension is the persisted key after these Redux actions settle.

## 6. Native share/import format

`website/src/views/routes/paths.ts`, `timetableShare()`, constructs:

```text
/timetable/<semester>/share?<serialized timetable>
```

`website/src/utils/timetables/shareLinks.ts` contains:

- `serializeTimetable()`
- `serializeModuleConfig()`
- `serializeModuleList()`
- `deserializeTimetable()`
- `getImportedModuleCodes()`

The current `LESSON_TYPE_ABBREV` mapping used by that serializer is defined in
`website/src/utils/timetables/lessonId.ts`: `Design Lecture → DLEC`, `Laboratory → LAB`,
`Lecture → LEC`, `Packaged Laboratory → PLAB`, `Packaged Lecture → PLEC`,
`Packaged Tutorial → PTUT`, `Recitation → REC`, `Sectional Teaching → SEC`,
`Seminar-Style Module Class → SEM`, `Tutorial → TUT`, `Tutorial Type 2 → TUT2`,
`Tutorial Type 3 → TUT3`, and `Workshop → WS`.

The current serializer uses module codes as query keys. Ordinary modules serialize lesson type abbreviations and class numbers, for example:

```text
CS2103T=LEC:1,TUT:03
```

TA lesson selections use parenthesized serialized `LessonId` values separated by semicolons between lesson types. Reserved keys are:

```text
hidden=<comma-separated module codes>
ta=<comma-separated module codes>
```

`TimetableContainer` recognizes only the `share` action. Its import path:

1. Parses the query with `query-string`.
2. Gets module codes with `getImportedModuleCodes()`.
3. Fetches any required current module data with `fetchModules()`.
4. Calls `deserializeTimetable(location.search, modules, semester)`.
5. Displays the result as a read-only timetable.
6. `SharingHeader.importTimetable()` dispatches `setTimetable()`, `setHiddenModulesFromImport()`, and `setTaModulesFromImport()` only after the user clicks **Import**.
7. `setTimetable()` calls `validateTimetableModules()` before `SET_TIMETABLE` reaches the reducer.

This path is intentionally safer than direct storage replacement and gives the user a native preview and undo notification.

## 7. Minimum normalized data

The proposed approximate format in the extension requirements is sufficient for ordinary modules but would lose data for TA-mode/multiple concrete lesson selections. The smallest lossless v1 extension schema should instead be:

```ts
interface SyncedTimetableV1 {
  schemaVersion: 1;
  academicYear: string;
  semester: number;
  modules: SyncedModuleV1[];
  updatedAt: number;
  deviceId: string;
}

interface SyncedModuleV1 {
  moduleCode: string;
  hidden: boolean;
  isTa: boolean;
  selections: SyncedLessonSelectionV1[];
}

interface SyncedLessonSelectionV1 {
  lessonType: string;
  selection:
    | { kind: 'classNo'; classNo: string }
    | { kind: 'lessonIds'; lessonIds: string[] };
}
```

Rules:

- A non-TA selection must contain exactly one class number.
- A TA selection preserves opaque lesson IDs exactly.
- `isTa` determines how NUSMods' share serialization must encode the selection.
- `hidden` is included because it changes which selected modules appear, and the native share format supports it.
- Colors and the academic-year archive are excluded from the synchronized MVP.
- Object keys and module/selection arrays should be sorted before hashing or equality comparison to avoid false changes caused by enumeration order.

Minimum data for an ordinary exact class-selection restore is academic year, semester, module code, lesson type, and class number. `isTa` plus lesson IDs are additionally required for lossless TA-mode restoration.

## 8. Safest extension read strategy

### Recommended MVP

Run an isolated content script only on the required NUSMods timetable pages and read the page-origin localStorage key directly:

```ts
window.localStorage.getItem('persist:timetables')
```

Then:

1. Parse the outer redux-persist object.
2. Parse only `lessons`, `hidden`, `ta`, `academicYear`, and `_persist`.
3. Validate every level and require `_persist.rehydrated === true` before accepting it.
4. Select the semester from the URL path and require a corresponding timetable entry.
5. Normalize and canonicalize it.
6. Compare a stable serialization/hash against the previous normalized snapshot.

For change detection, compare the raw `persist:timetables` string approximately once per second and debounce accepted changes by roughly 750 ms. If the raw string is unchanged, do nothing. This is a single local in-memory string comparison—not DOM polling, network activity, or repeated Chrome sync writes.

Why not rely only on a `storage` event: browsers do not fire it in the same document that performed the localStorage write. It helps with other-tab writes but does not reliably detect the active NUSMods page's own changes.

Why not patch `Storage.prototype.setItem` initially: a page-world hook could emit an event immediately, but it modifies a global primitive used by upstream code, requires a main-world/isolated-world bridge, and is more sensitive to Chrome and NUSMods changes. It can be considered later if measured one-second latency is unacceptable.

Why not Redux DevTools/store access: the store is not exposed as a supported public API. Reaching into bundler internals would be more brittle than observing the official persistence boundary.

## 9. Safest restore strategy

Generate the same query representation as `serializeTimetable()` and navigate the current tab to:

```text
https://nusmods.com/timetable/<matching-semester>/share?<query>
```

The extension's **Apply timetable** action should mean "open the validated native import preview." The extension should not click NUSMods' Import button or manipulate its DOM. The final destructive replacement remains an explicit NUSMods-controlled confirmation.

Before navigation, the extension must:

- Validate its own schema and normalized invariants.
- Require an academic-year match.
- Warn on semester mismatch and require the user's confirmation.
- Save the current normalized timetable to local extension history.
- Refuse to serialize unknown lesson-selection variants.
- Properly URL-encode module keys and values rather than relying on today's safe-character assumptions.

This approach handles missing or changed modules through NUSMods' current fetch/deserialization/validation code and never mutates the saved timetable merely by receiving a remote update.

### Rejected MVP restore alternatives

- **Write `persist:timetables` and reload:** unsafe race with redux-persist, tightly coupled to nested encoding, bypasses validation, and could damage unrelated semesters/archive data.
- **Inject Redux actions:** no supported store bridge exists, and accessing bundled internals is brittle.
- **DOM automation:** selectors and component layout are presentation details and can change independently of the data model.

## 10. Integration assumptions to carry into implementation

1. The extension will support the current persisted schema and fail closed on unknown upstream shapes.
2. It will synchronize one normalized timetable per sync key initially, not the entire NUSMods persisted reducer.
3. It will read from `persist:timetables`, never from rendered timetable cells.
4. It will use the URL path as the authoritative displayed semester and the persisted `academicYear` as the year guard.
5. It will observe the serialized storage key with lightweight comparison and debounce; no aggressive DOM polling.
6. Restore will open NUSMods' native share/import preview and leave the final Import confirmation to NUSMods.
7. TA-mode lesson IDs will be preserved losslessly as opaque strings.
8. Unknown schema, corrupt storage, academic-year mismatch, or failed serialization will never produce a storage write or timetable replacement.

## Upstream source index

- `website/src/bootstrapping/configure-store.ts`
  - `configureStore()`, `persistStore()`, legacy `reduxState` removal
- `website/src/storage/persistReducer.ts`
  - persisted reducer wrapper, `redux-persist/lib/storage`
- `website/src/storage/localStorage.ts`
  - `getLocalStorage()`, browser-storage capability check and in-memory fallback
- `website/src/reducers/index.ts`
  - `persistReducer('timetables', ...)`, root update path
- `website/src/reducers/timetables.ts`
  - `persistConfig`, `defaultTimetableState`, `timetables()`, `semTimetable()`, `moduleLessonConfig()`
- `website/src/reducers/app.ts`
  - non-persisted `activeSemester` and `activeLesson`
- `website/src/types/reducers.ts`
  - `TimetablesState`, semester maps
- `website/src/types/timetables.ts`
  - `ModuleLessonConfig`, `SemTimetableConfig`, `TimetableConfig`, historical representations
- `website/src/actions/timetables.ts`
  - module, lesson, TA, hide/show, reset, validation, and import actions
- `website/src/views/routes/Routes.tsx`
  - timetable route
- `website/src/views/routes/paths.ts`
  - semester mapping, `timetablePage()`, `timetableShare()`
- `website/src/views/timetable/TimetableContainer.tsx`
  - path resolution, share parsing, module fetching, preview, `SharingHeader.importTimetable()`
- `website/src/views/timetable/TimetableContent.tsx`
  - UI handlers that dispatch timetable mutations
- `website/src/utils/timetables/shareLinks.ts`
  - `serializeTimetable()`, `deserializeTimetable()`, query formats
- `website/src/utils/timetables/lessonId.ts`
  - concrete lesson identity serialization
- `website/src/utils/timetables/validation.ts`
  - current-module and lesson validation used by action/import flows
