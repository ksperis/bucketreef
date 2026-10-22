/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const config = await readFile(new URL("../nginx.conf.template", import.meta.url), "utf8");

test("revalidates the SPA shell and caches fingerprinted assets immutably", () => {
  assert.match(
    config,
    /map \$uri \$frontend_cache_control \{[\s\S]*?\/index\.html "no-cache, must-revalidate";[\s\S]*?~\^\/assets\/ "public, max-age=31536000, immutable";[\s\S]*?\}/,
  );
  assert.match(config, /add_header Cache-Control \$frontend_cache_control always;/);
  assert.match(config, /location = \/index\.html \{[\s\S]*?try_files \$uri =404;[\s\S]*?\}/);
  assert.match(config, /location \/assets\/ \{[\s\S]*?try_files \$uri =404;[\s\S]*?\}/);
  assert.match(config, /location \/ \{[\s\S]*?try_files \$uri \/index\.html;[\s\S]*?\}/);
  assert.doesNotMatch(config, /location \^~ \/assets\//);
});

test("keeps Browser direct-transfer workers out of the immutable asset cache", () => {
  const workerStart = config.indexOf("location ~ ^/(?:api/browser/direct-transfer-worker/|assets/)");
  const workerEnd = config.indexOf("\n    location = /index.html", workerStart);

  assert.notEqual(workerStart, -1);
  assert.notEqual(workerEnd, -1);
  const workerBlock = config.slice(workerStart, workerEnd);
  assert.match(workerBlock, /add_header Cache-Control "no-store, private" always;/);
  assert.match(workerBlock, /etag off;/);
});
