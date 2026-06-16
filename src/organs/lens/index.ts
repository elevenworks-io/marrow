// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens — MARROW's Mark-native observability organ. Lens 0: the trace view, a
 * pure read-only projection of the decision chain (the trace IS the events).
 */

export { type TraceNode, type TraceForest, summaryOf, replayTrace } from "./trace.js";
export { type EpisodeSummary, summarizeEpisodes } from "./episode.js";
export { renderTrace } from "./render.js";
