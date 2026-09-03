import assert from "node:assert/strict";
import test from "node:test";

import {
  CORE_PROMPT_VERSION,
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
} from "../../src/v2/prompts/notification-analysis-core-p1-v2.js";

test("Core prompt is versioned, bounded, and contains the approved trust boundary", () => {
  assert.equal(
    CORE_PROMPT_VERSION,
    "notification-analysis-core-prompt-p1-v2",
  );
  assert.ok(
    Buffer.byteLength(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2, "utf8") <= 2_000,
  );
  assert.match(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2, /untrusted data/iu);
  assert.match(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2, /exactly once/iu);
  assert.match(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2, /input\.profile_refs/iu);
  assert.match(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2, /Never browse, call tools/iu);
  assert.match(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2, /Return only the JSON object/iu);
  assert.doesNotMatch(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2, /COMP7101/iu);
});
