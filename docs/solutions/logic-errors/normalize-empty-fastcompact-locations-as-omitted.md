---
title: Normalize empty fastcompact locations as omitted
date: 2026-07-11
category: logic-errors
module: fastcompact
problem_type: logic_error
component: tooling
symptoms:
  - "Error: pass either 'location' (single) or 'locations' (multiple), not both."
  - Callers that serialize every schema field fail when a real location is paired with locations: []
  - Blank location: "" was already accepted; empty locations: [] still tripped either/or rejection
root_cause: missing_validation
resolution_type: code_fix
severity: medium
related_components:
  - documentation
  - testing_framework
tags:
  - fastcompact
  - input-validation
  - empty-array
  - blank-string
  - schema-serialization
  - morph
  - either-or
---

# Normalize empty fastcompact locations as omitted

## Problem

`fastcompact` rejects `location` and `locations` together. After blank-string `location` was treated as omitted, callers that still emit every schema field failed when they sent a real `location` plus a serialized-but-empty `locations: []`.

## Symptoms

- Tool error: `pass either 'location' (single) or 'locations' (multiple), not both.`
- Trace shows a non-empty `location` and `locations: []` in the same call
- `{ locations: [] }` alone still needs the distinct "at least one entry" message

## What Didn't Work

- Normalizing only blank `location` (empty/whitespace string → omitted) fixed half the serialization pattern and left empty arrays as "provided"
- Leaving Zod schema and DESCRIPTION silent on the exactly-one rule let agents keep emitting both fields

## Solution

Normalize both sides before exclusivity checks. Treat a blank or whitespace-only `location` and an empty `locations` array as omitted, then apply either/or and missing-input rules on the normalized values. Keep the empty-list message branch on the raw `params.locations !== undefined` so `{ locations: [] }` alone still reports "at least one entry".

```ts
const single = params.location?.trim() ? params.location : undefined;
const multi = params.locations?.length ? params.locations : undefined;
if (single !== undefined && multi !== undefined) {
  return textToolResult(
    "Error: pass either 'location' (single) or 'locations' (multiple), not both. Omit the unused field entirely; blank or empty values are ignored.",
    true,
  );
}

const list: string[] = single !== undefined ? [single] : multi ?? [];
if (list.length === 0) {
  return textToolResult(
    params.locations !== undefined
      ? "Error: 'locations' must contain at least one entry."
      : "Error: provide 'location' for a single input or 'locations' for multiple inputs.",
    true,
  );
}
```

Also state the exactly-one rule in the Zod `.describe()` strings and the tool DESCRIPTION `INPUT MODES` block so agents omit the unused field instead of serializing both. When editing Zod property chains, keep trailing commas after each `.describe(...)`.

## Why This Works

"Provided" for exclusivity must mean "names at least one locator," not "the field is present on the wire." Callers that dump every schema key will always send empty strings and empty arrays for unused optional fields. Normalizing those empties to `undefined` makes the either/or check match caller intent, while branching the empty-list error on raw `params.locations !== undefined` preserves the specific message for an explicit empty multi-input.

## Prevention

- When a tool has mutually exclusive optional fields, normalize blank strings and empty arrays to omitted before exclusivity checks
- Keep empty-collection error messages keyed off raw presence when the collection was explicitly supplied empty
- Document exactly-one input modes in both schema descriptions and the tool prompt
- Regression-test the full matrix: real+empty, blank+real, real+real, both-empty, neither

## Related Issues

- `docs/solutions/architecture-patterns/morph-compaction-routing-and-closure-scoped-state.md` — session compaction routing; not tool input modes
- Release 0.3.7 blank-`location` fix was necessary but incomplete; 0.3.8 closes the empty-`locations` half
