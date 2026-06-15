// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The Postgres integration tests share one database; run test files
    // serially so they don't race on the same tables. The suite is tiny.
    fileParallelism: false,
  },
});
