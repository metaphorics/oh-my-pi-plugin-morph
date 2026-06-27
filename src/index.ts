import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import {
  MORPH_COMPACT_ENABLED,
  MORPH_EDIT_ENABLED,
  MORPH_FASTCOMPACT_ENABLED,
  MORPH_ROUTING_HINT_ENABLED,
  MORPH_ROUTING_HINT_HEADER,
  MORPH_WARPGREP_ENABLED,
  MORPH_WARPGREP_GITHUB_ENABLED,
} from "./config.js";
import { makeBeforeCompact } from "./compaction.js";
import { buildMorphSystemRoutingHint } from "./routing.js";
import { makeFastCompact } from "./tools/fastcompact.js";
import { makeMorphEdit } from "./tools/morph-edit.js";
import { makeWarpgrepCodebase, makeWarpgrepGithub } from "./tools/warpgrep.js";

export default function morphPlugin(pi: ExtensionAPI): void {
  if (MORPH_EDIT_ENABLED) pi.registerTool(makeMorphEdit(pi));
  if (MORPH_WARPGREP_ENABLED) pi.registerTool(makeWarpgrepCodebase(pi));
  if (MORPH_WARPGREP_GITHUB_ENABLED) pi.registerTool(makeWarpgrepGithub(pi));
  if (MORPH_FASTCOMPACT_ENABLED) pi.registerTool(makeFastCompact(pi));

  if (MORPH_ROUTING_HINT_ENABLED) {
    const hint = buildMorphSystemRoutingHint();
    if (hint) {
      pi.on("before_agent_start", async (event) => ({
        systemPrompt: event.systemPrompt.some((entry) =>
          entry.includes(MORPH_ROUTING_HINT_HEADER),
        )
          ? event.systemPrompt
          : [...event.systemPrompt, hint],
      }));
    }
  }

  if (MORPH_COMPACT_ENABLED) {
    // Per-session state: omp invokes this factory once per session/subagent with
    // its own `pi`, so these live in the closure (never module scope) — a
    // subagent's auto-compaction must not corrupt the main session's counter.
    //
    // `autoCompactionDepth` distinguishes auto compaction (Morph is the default)
    // from manual `/compact` (Morph only when opted in). The host brackets every
    // auto pass with auto_compaction_start/end, always paired across success,
    // abort, and error; a counter (not a bool) tolerates an aborted pass whose
    // end overlaps the next pass's start.
    let autoCompactionDepth = 0;
    // True only while the dedicated `/morph-compact` command drives compaction,
    // so its hook run forces Morph past the manual gate and the snapcompact yield.
    let morphCompactForced = false;

    pi.on("auto_compaction_start", async () => {
      autoCompactionDepth++;
    });
    pi.on("auto_compaction_end", async () => {
      if (autoCompactionDepth > 0) autoCompactionDepth--;
    });

    pi.on(
      "session_before_compact",
      makeBeforeCompact(pi, {
        isAutoCompacting: () => autoCompactionDepth > 0,
        isMorphCompactForced: () => morphCompactForced,
      }),
    );

    pi.registerCommand("morph-compact", {
      description: "Compact the session now using Morph",
      handler: async (_args, ctx) => {
        morphCompactForced = true;
        try {
          await ctx.compact();
        } finally {
          morphCompactForced = false;
        }
      },
    });
  }
}
