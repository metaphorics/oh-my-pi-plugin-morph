export let MORPH_API_KEY = process.env.MORPH_API_KEY;

export function setMorphApiKey(apiKey: string | undefined): void {
  MORPH_API_KEY = apiKey;
}

export const MORPH_API_URL = "https://api.morphllm.com";
export const MORPH_TIMEOUT = 30_000;
export const MORPH_WARP_GREP_TIMEOUT = 60_000;
export const MORPH_COMPACT_TIMEOUT = 60_000;
export const GITHUB_RESOLVER_TIMEOUT = 10_000;
export const GITHUB_REPO_API_URL = "https://api.github.com/repos";
export const GITHUB_REPO_SEARCH_URL = "https://api.github.com/search/repositories";
export const GITHUB_REPO_SUGGESTION_LIMIT = 5;

export const EXISTING_CODE_MARKER = "// ... existing code ...";
export const MORPH_ROUTING_HINT_HEADER = "Morph plugin routing hints:";
export const PLUGIN_VERSION = "0.1.0";

const parsedCompactRatio = Number.parseFloat(
  process.env.MORPH_COMPACT_RATIO || "0.3",
);
export const COMPACT_RATIO =
  Number.isFinite(parsedCompactRatio) && parsedCompactRatio >= 0.05 && parsedCompactRatio <= 1
    ? parsedCompactRatio
    : 0.3;

export const MORPH_EDIT_ENABLED = process.env.MORPH_EDIT !== "false";
export const MORPH_WARPGREP_ENABLED = process.env.MORPH_WARPGREP !== "false";
export const MORPH_WARPGREP_GITHUB_ENABLED =
  process.env.MORPH_WARPGREP_GITHUB !== "false";
export const MORPH_COMPACT_ENABLED = process.env.MORPH_COMPACT !== "false";
export const MORPH_FASTCOMPACT_ENABLED = process.env.MORPH_FASTCOMPACT !== "false";
export const MORPH_ROUTING_HINT_ENABLED =
  process.env.MORPH_ROUTING_HINT !== "false";

// Per-compaction policy gates. Unlike the registration flags above (read once at
// import to decide what to register), these are read live on every compaction so
// a session can flip them without a reload and tests can exercise both states.
// They use opt-IN (`=== "true"`) semantics, the inverse of the opt-OUT
// (`!== "false"`) registration flags.
//
// Manual `/compact` substitutes Morph only when explicitly opted in. Auto
// compaction defaults to Morph (gated only by MORPH_COMPACT). The dedicated
// `/morph-compact` command always uses Morph regardless of this gate.
export function morphCompactManualEnabled(): boolean {
  return process.env.MORPH_COMPACT_MANUAL === "true";
}

// When the active compaction strategy is "snapcompact", Morph yields to it so it
// does not silently override the host's image-archive compaction. Opt in to let
// Morph take precedence (e.g. text-only models where snapcompact would fall back
// to an LLM summary anyway). The `/morph-compact` command overrides regardless.
export function morphCompactOverridesSnapcompact(): boolean {
  return process.env.MORPH_COMPACT_OVERRIDE_SNAPCOMPACT === "true";
}

// Upper bound on the bytes of a single resolved fastcompact input (file or
// artifact) checked before any Morph API call, and the maximum number of
// locations one fastcompact call may target. Both gate the SDK call so a single
// tool call cannot stream an unbounded payload to Morph.
export const FASTCOMPACT_MAX_BYTES = 1_048_576;
export const FASTCOMPACT_MAX_LOCATIONS = 10;

// Upper bound on the UTF-8 byte length of the optional fastcompact focus query,
// checked before any Morph API call so a single tool call cannot smuggle an
// unbounded query string to Morph alongside the bounded input.
export const FASTCOMPACT_MAX_QUERY_BYTES = 16_384;
