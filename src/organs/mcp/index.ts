// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The first organ: the Mark exposed over MCP (ADR-0006). Public surface for
 * programmatic use; `main.ts` is the runnable stdio entry point.
 */

export { MarkService } from "./service.js";
export { createMarkMcpServer } from "./server.js";
