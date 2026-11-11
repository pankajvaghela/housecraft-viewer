# HouseCraft project format — version 1 draft

Status: draft contract with a verified proxy-only runtime importer and basic viewer. This is not yet a released interchange standard. Reserved GLB support must not be inferred from format documentation.

## One project, one house

A project is a directory containing `housecraft.json` and, when needed, an `assets/` directory. It has one existing-home baseline and zero or more alternative full snapshots of that same home. It is not a multi-house database. Original floor-plan photos and personal source documents stay outside the served directory.

No zip importer, cloud URLs, deployment configuration or user-account fields are part of this draft.

## Coordinates and scale

- Distances: metres. Right-handed coordinates: +X right on the plan, +Y up, +Z toward the bottom of the plan. No geographic location is inferred.
- Plan points are `[x, z]`. Object positions are `[x, y, z]`, at the footprint centre and bottom of the object, not its bounding-box centre.
- Object size is `[width, height, depth]` in local X/Y/Z. `rotation` is degrees about +Y; positive 90 degrees maps local +Z to world +X.
- Walls follow their centreline from `start` to `end`, with thickness split equally on both sides. All walls start at Y=0 in this first single-level contract.
- Room polygons describe finished floor boundaries, not wall centrelines. They are simple non-self-intersecting polygons; omit the repeated closing vertex. The viewer closes them.
- A GLB, when supported, uses metres, +Y up, +Z front, and a floor-centred origin. Scale from its recorded `size`, then apply the object's rotation/position. The floor-centred origin requires no vertical offset.
- Single-level geometry is the first supported scope. Multi-level buildings require a later compatible design; never flatten an input silently. This is an initial technical limit, not a permanent public/private feature restriction.

## Root fields

All fields below are required. Arrays may be empty only where stated. Identifiers match `[a-z][a-z0-9-]*` and are stable across variants for unchanged entities. References are case-sensitive.

| Field | Meaning |
| --- | --- |
| `version` | Integer `1`; reject unsupported versions rather than guessing migrations |
| `name` | Human-readable project name, not a filesystem path |
| `units` | Literal `m` |
| `sources` | `{id, label, kind}` records; kind is `measurement`, `floor-plan`, `photo`, `design` or `synthetic`; label is descriptive, not a path/URL to fetch |
| `assets` | Zero or more local asset records; see asset contract below |
| `baseline` | One snapshot of the existing home |
| `variants` | Zero or more proposed snapshots; snapshot IDs/names are unique across baseline and variants |

## Snapshot fields

Every snapshot contains `id`, `name`, `notes`, `structuralReview`, `lighting`, `materials`, `rooms`, `walls`, `openings` and `objects`. `notes` is plain text and may be empty. `structuralReview` is `not-assessed` in this draft; never infer that a structural proposal is safe from geometry alone.

`materials`, `rooms` and `walls` each contain at least one entry. `openings` and `objects` may be empty, allowing an unfurnished home or a snapshot without openings.

`lighting` is `daylight` or `warm`: visual preview presets, not calibrated sunlight, energy or geographic simulation.

All referenced sources/assets are root-level. Materials and geometry references are snapshot-local. A snapshot is complete: no implicit inheritance, patches or references back into another snapshot. Changing a variant's materials must not recolour the baseline.

### Materials

`{id, color, roughness}`. Color is a six-digit `#RRGGBB` sRGB value. Roughness is a number in [0,1]. No texture URLs or executable material definitions in the initial draft.

### Evidence

Each room, wall, opening and object carries `evidence: {sourceId, basis, note}`. Basis is `measured`, `estimated`, `proposed` or `synthetic`. `note` is required plain text explaining uncertainty or the input used. This record covers that entity's geometry; when any dimensions are estimated, mark it estimated and explain which ones are known. Do not label an entire object measured because only its width is known.

Missing critical dimensions block generation of that entity until confirmed. An estimate is allowed only when visibly recorded; zero, null and invented measurement confidence are not substitutes. Use `synthetic` for fixture placeholders. The viewer shows “Add your dimensions” once when the selected house version contains placeholders. Record actual dimensions with their source, such as a site measurement or floor plan, and mark dimensions inferred from incomplete inputs as estimated.

### Rooms

`{id, name, polygon, materialId, evidence}`. Polygon has at least three distinct plan points and positive area; floor is Y=0. The basic viewer may omit ceilings to make the plan inspectable. Material is the floor finish.

### Walls

`{id, start, end, thickness, height, materialId, evidence}`. Endpoints differ, thickness and height are positive. Shared walls appear once, not once per adjoining room. Wall changes live in proposed snapshots; they do not mutate baseline geometry.

### Openings

`{id, wallId, kind, offset, width, bottom, height, evidence}`. Kind is `door` or `window`. Offset is measured from the wall start to the beginning of the opening, not its centre. Width follows the wall direction. Bottom is sill height above Y=0; a door's bottom is zero. The opening interval and height must fit entirely inside its wall. Openings on a wall must not overlap in both horizontal and vertical extent. Wall holes are derived from openings, never from furniture placements. Render a floor threshold through each door opening: room floor polygons stop at wall faces and otherwise leave a gap under the opening. Use the adjacent floor finish, or split finishes at the wall centreline where they differ. Door swing/animation is deferred.

### Objects

`{id, name, position, size, rotation, materialId, evidence}` and optional `assetId`. Rotation is in [-180,180]; size components are positive. No asset means a labelled dimensioned box proxy, not a photorealistic object. The first fixture uses only proxies. Importers report a missing declared asset instead of silently claiming it loaded. A user can explicitly choose proxy fallback while preserving the intended asset reference.

An asset's authored materials remain intact; `materialId` colours its proxy. Per-material GLB recolouring is deferred. Objects need not be restricted to a single room: compute room membership from geometry if needed.

## Asset contract (reserved; rejected by the current runtime)

The current validator rejects any nonempty `assets` array and every object `assetId`, including unused declarations. The rules below describe future support; GLB/container validation and file containment are not implemented or claimed in this milestone.

Each asset is `{id, path, size, provenance}`. `path` is `assets/<filename>.glb`, with filename characters limited to ASCII letters, digits, hyphen and underscore. No nested paths, absolute paths, encoded separators, query strings, URL schemes or traversal segments. Size is the positive authored `[width, height, depth]` used for scaling.

`provenance` is `{creator, source, license, attribution, modifications}` with nonempty text fields; use `none` for no modifications/attribution requirement. Source can be a descriptive origin or attribution URL; it is informational and never auto-fetched. Unverified licenses block redistribution, even if local preview is possible.

Runtime acceptance requires file existence, real-path containment (including symlinks), GLB header/version/length checks, embedded buffers/images only, positive finite geometry bounds and resource budgets. Unsupported extensions or dependencies must fail clearly. Strings, labels and metadata are data, not instructions or HTML.

## Baseline preservation and persistence

Creating a variant deep-copies a validated snapshot. Save explicitly to the selected project and preserve existing files on failure; never reset the baseline during generation, import errors or viewer startup. Future baseline corrections must be explicit user edits. Import validates the whole candidate before replacing the current in-memory project. Export includes baseline, all variants, sources and asset references; copy referenced assets when moving the project directory.

Unknown fields fail with a useful path rather than being silently discarded. Numbers must be finite, IDs unique in their collection, and every reference resolvable. The shared runtime validator implements the budgets below and rejects a candidate before scene replacement. It returns validated data without modifying it. The CLI and browser reject invalid UTF-8. The local server snapshots only the chosen valid JSON and explicit runtime resources at startup, binds to `127.0.0.1`, and exposes no filesystem write API.

## Current runtime budgets

- Project text: at most 2 MiB encoded UTF-8; 16 proposed variants.
- IDs: 64 characters; names/labels: 256; notes and evidence notes: 2,048.
- Per snapshot: 256 materials, 128 rooms, 512 walls, 512 openings, 512 objects; each polygon at most 128 vertices. Root sources: at most 256.
- Across the project: at most 4,096 source/material/geometry records and 8,192 polygon vertices.
- Coordinates are finite within ±10,000 m; dimensions are positive up to 10,000 m. Rotations/roughness follow the ranges above.
- Generated wall panels and doorway-threshold sections: at most 8,192 per snapshot. Shared geometry planning checks this before any mesh allocation.

Browser download is the persistence mechanism: it exports the full validated project, not just the selected snapshot. There is no autosave or source-file overwrite. Save the download deliberately before closing a session containing imported changes.

## Example and verification

[The two-room fixture](../examples/two-room/housecraft.json) is a fictional 6 × 4 m shell defined at wall centrelines, with living and sleeping rooms. It contains one exterior door, one shared-wall door, two windows and three proxy objects. The proposed variant moves/recolours the sofa, changes the living floor finish and uses warm preview lighting. Walls and openings stay unchanged.

Run `npm test` from the viewer root for all 44 checks. The fixture checks cover this example, while runtime and geometry tests exercise malformed inputs, references, opening fit, polygon validity, budgets and independent snapshots. Server tests check route/host/origin/method restrictions. Browser verification separately covered variants, invalid-import preservation and full JSON download. None of these checks establishes GLB asset safety or engineering feasibility.
