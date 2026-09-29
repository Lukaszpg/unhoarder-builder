# UnHoarder - Builder

A static, browser-based editor for **UnHoarder 1.0.0** `filter.json` files for Diablo II: Resurrected.

The site has no backend and no external runtime dependencies. D2R Excel files are read locally by the browser, persisted locally with IndexedDB for the next visit, and are never sent anywhere.

## Features

- Canonical UnHoarder **schema v3** output.
- Ordered `Show` / `Hide` rules with `Continue`; rule cards have a six-dot drag grip on the left, support drag-to-reorder, and auto-scroll the list/page when dragged toward either vertical edge. Arrow buttons remain available for precise/keyboard-friendly ordering.
- Duplicate and delete actions live directly on each left-side rule card; Duplicate uses the copy icon beside Delete.
- Optional `ruleName` metadata for human-readable rule labels in the Builder; UnHoarder ignores it at runtime.
- Conditions for:
  - `code`
  - `baseName`
  - `itemType`
  - `quantity`
  - `rarity`
  - `itemLevel`
  - `sockets`
  - `ethereal`
  - `identified`
- The **Actions** editor is shown for `Show` rules and hidden for `Hide` rules; existing action metadata is preserved if a rule is temporarily switched to `Hide`.
- Actions for:
  - custom ground name
  - tooltip background color
  - tooltip text color
  - drop sound
  - minimap icon shape/colors/size
- Live tooltip visualization for the selected rule, including custom name, background color, and text color.
- Searchable base-item, unique-item, and set-item helper.
- Excel upload panel automatically collapses to compact loaded-file badges once all six data tables are loaded. With data loaded, click the panel to fold/unfold it manually; the top-toolbar **Clear data** action clears the loaded data and restores the full upload panel.
- Import an existing schema-v3 `filter.json`.
- Automatic local workspace persistence with **IndexedDB**: the current filter, selected rule, Excel/catalog source files, and data-panel fold state are restored after reload or browser restart.
- Live validation using UnHoarder 1.0.0 limits.
- Download ready-to-use `filter.json`.
- Fully client-side; suitable for GitHub Pages.

## Local workspace persistence

UnHoarder - Builder automatically stores the current workspace in the browser's **IndexedDB** database named `unhoarder-builder`. The six supported Excel/catalog files are stored as their original filename + text and are reparsed on the next visit, so parser improvements apply to previously loaded data. The current schema-v3 filter is autosaved after edits.

- **Clear data** removes the persisted Excel/catalog files and unfolds the data panel, but keeps the current filter.
- **New filter** replaces the persisted current filter after confirmation.
- Importing a `filter.json` makes the imported filter the new locally saved working filter.
- `Download filter.json` remains the recommended backup/export mechanism. Browser storage can be removed by clearing site data and is generally temporary in private/incognito sessions.
- IndexedDB storage belongs to the site origin. Moving the Builder from one GitHub Pages URL/domain to another creates a separate local workspace.

No saved workspace data is transmitted to GitHub or any other server.

## Game / mod data files

For the full editor experience, drop these files into the **Load game / mod data** area:

| File | Purpose | Required for full catalog mode |
|---|---|---:|
| `weapons.txt` | Weapon codes, literal base names, item types | Yes |
| `armor.txt` | Armor codes, literal base names, item types | Yes |
| `misc.txt` | Miscellaneous item codes and item types | Yes |
| `itemtypes.txt` | `ItemType` / `Code` / `Equiv1` / `Equiv2` hierarchy | Yes |
| `UniqueItems.txt` | Unique-name search and base-item lookup | No |
| `SetItems.txt` | Set-name search and base-item lookup | No |

The unique/set tables are **editor enrichment only**. The generated filter never creates unsupported unique/set identity conditions. Selecting a unique or set item generates a supported base selector plus `rarity: "unique"` or `rarity: "set"`.

### Base-name behavior

`baseName` is generated only from the literal `name` column of `weapons.txt` and `armor.txt`, matching UnHoarder 1.0.0. Miscellaneous items use their item `code` instead.

### Item-type behavior

The editor resolves `itemType` using `itemtypes.txt` plus `type` / `type2` from `weapons.txt`, `armor.txt`, and `misc.txt`. `Equiv1` and `Equiv2` inheritance is expanded transitively, matching the plugin's reload-time model.

## Running locally

No build is required. You can open `index.html` directly in a modern browser.

For an HTTP preview, from this folder you can also run:

```bash
python -m http.server 8000
```

then open `http://localhost:8000`.

## Deploying to GitHub Pages

1. Create a GitHub repository.
2. Put the contents of this folder in the repository root.
3. Push to your publishing branch, typically `main`.
4. Open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Choose the branch and `/(root)` folder, then save.

The included `.nojekyll` file makes it explicit that the site is plain static content.

## Development checks

The parser / validation model has a dependency-free Node test:

```bash
node tests/model.test.js
```

Syntax checks:

```bash
node -c js/filter-model.js
node -c js/workspace-store.js
node -c js/app.js
node tests/persistence-contract.test.js
node tests/workspace-store.test.js
```

## UnHoarder limits mirrored by the editor

- schema `version: 3`
- optional `ruleName`: informational string used by the Builder only; no effect on runtime matching or actions
- maximum 4,096 rules
- maximum serialized config size: 4 MiB
- `code`: 1–4 printable ASCII characters
- `baseName` / `itemType`: string or array, up to 64 values
- rarity: `inferior`, `normal`, `superior`, `magic`, `set`, `rare`, `unique`
- `itemLevel`: 1–99
- `quantity`: 0–255
- `sockets`: 0–6
- numeric operators: `eq`, `gt`, `gte`, `lt`, `lte`
- custom name: 1–79 ASCII bytes, up to 3 non-empty lines, max 55 characters per line
- tooltip colors: `RGBA(r, g, b, a)` with RGB 0–255 and alpha 0–1
- drop sound: 1–63 characters using letters, numbers, `_`, `-`
- minimap shapes: `circle`, `diamond`, `triangle`, `star`
- minimap size defaults to 12 px and is clamped by UnHoarder to 12–40 px

## Notes

This editor intentionally targets the current production rule language. It does not add hidden-affix, unique-identity, set-identity, runeword-identity, or other unsupported/oracle conditions.
