import {
  CORE_PROMPT_VERSION,
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
} from "./notification-analysis-core-p1-v2.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
  PHASE2R_CORE_PROMPT_VERSION,
} from "./notification-analysis-core-p2-v1.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V2,
  PHASE2RC_CORE_PROMPT_VERSION,
} from "./notification-analysis-core-p2-v2.js";
import { hashUtf8 } from "../validation/canonical-json.js";

function promptContract({ version, instructions, maxUtf8Bytes, promptHash }) {
  if (
    hashUtf8(instructions) !== promptHash ||
    Buffer.byteLength(instructions, "utf8") > maxUtf8Bytes
  ) {
    throw new TypeError(`Core prompt contract drifted: ${version}`);
  }
  return Object.freeze({
    version,
    instructions,
    max_utf8_bytes: maxUtf8Bytes,
    prompt_hash: promptHash,
  });
}

const contracts = new Map([
  [
    CORE_PROMPT_VERSION,
    promptContract({
      version: CORE_PROMPT_VERSION,
      instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
      maxUtf8Bytes: 2_000,
      promptHash:
        "sha256:3a3f4dead9315314eb2e1101c3eb00019a11ce27b538a0bf3e404ba58251151b",
    }),
  ],
  [
    PHASE2R_CORE_PROMPT_VERSION,
    promptContract({
      version: PHASE2R_CORE_PROMPT_VERSION,
      instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
      maxUtf8Bytes: 3_600,
      promptHash:
        "sha256:dade3413a05f2485f22ea6bd5cff8c0c62ef60c5ce1da4ac325775f9dd22b25d",
    }),
  ],
  [
    PHASE2RC_CORE_PROMPT_VERSION,
    promptContract({
      version: PHASE2RC_CORE_PROMPT_VERSION,
      instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V2,
      maxUtf8Bytes: 5_200,
      promptHash:
        "sha256:78461050b2a0203bfbbf35cfcfe92d9a555e4b3c8e2ebf36452824ce8699e648",
    }),
  ],
]);

export function resolveCorePromptContract(version) {
  const contract = contracts.get(version);
  if (!contract) throw new TypeError("Core prompt version is not registered");
  return contract;
}

export const CORE_PROMPT_REGISTRY_VERSIONS = Object.freeze([
  ...contracts.keys(),
]);
