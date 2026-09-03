import { PHASE2_DEVELOPMENT_CASE_IDS } from "../phase2/development-input-loader.js";
import { hashCanonicalJson } from "../validation/canonical-json.js";
import {
  PHASE2R_SENDER_SCHOOL_MAPPING_VERSION,
  PHASE2R_SOURCE_CONTEXT_SNAPSHOT_VERSION,
} from "./phase2r-source-context-contract.js";

export {
  PHASE2R_SENDER_SCHOOL_MAPPING_VERSION,
  PHASE2R_SOURCE_CONTEXT_SNAPSHOT_VERSION,
};

const SYNTHETIC_SENDER_SCHOOL_MAPPINGS = Object.freeze([
  Object.freeze({
    mapping_id: "synthetic-harbour-university-domain-v1",
    domain_suffix: "harbour.invalid",
    provider_mapping_version: "syn-allowlist-v1",
    sender_school_name: "港湾大学",
  }),
]);

function senderDomain(address) {
  if (typeof address !== "string") throw new TypeError("sender address is invalid");
  const match = /^[^@\s]+@([a-z0-9.-]+)$/u.exec(address.toLowerCase());
  if (!match || !match[1].endsWith(".invalid")) {
    throw new TypeError("sender address must use a synthetic .invalid domain");
  }
  return match[1];
}

function mappingForAddress(address) {
  const domain = senderDomain(address);
  const matches = SYNTHETIC_SENDER_SCHOOL_MAPPINGS.filter(
    ({ domain_suffix: suffix }) =>
      domain === suffix || domain.endsWith(`.${suffix}`),
  );
  if (matches.length > 1) throw new TypeError("sender school mapping is ambiguous");
  return matches[0] ?? null;
}

function trustedMappingForFixture(fixture) {
  const from = fixture?.input?.message?.from;
  const mapping = mappingForAddress(from?.address);
  if (mapping === null) return null;
  const providerRaw = from?.provider_raw;
  return providerRaw?.connector_authenticated === true &&
    providerRaw?.allowlist_match === true &&
    providerRaw?.service_scope_match === true &&
    providerRaw?.allowlist_mapping_version === mapping.provider_mapping_version
    ? mapping
    : null;
}

function sourceCase(fixtures, caseId) {
  const matches = fixtures.filter((fixture) => fixture?.case_id === caseId);
  if (matches.length !== 1) throw new TypeError(`${caseId} must appear once`);
  return matches[0];
}

export function buildPhase2rSourceContextSnapshot(fixtures) {
  if (!Array.isArray(fixtures)) throw new TypeError("fixtures must be an array");
  const cases = PHASE2_DEVELOPMENT_CASE_IDS.map((caseId) => {
    const fixture = sourceCase(fixtures, caseId);
    if (fixture.dataset_split !== "development") {
      throw new TypeError(`${caseId} must be a development fixture`);
    }
    const mapping = trustedMappingForFixture(fixture);
    return {
      caseId,
      sender_school_name: mapping?.sender_school_name ?? null,
      mapping_id: mapping?.mapping_id ?? null,
    };
  });
  const content = {
    snapshotVersion: PHASE2R_SOURCE_CONTEXT_SNAPSHOT_VERSION,
    mappingVersion: PHASE2R_SENDER_SCHOOL_MAPPING_VERSION,
    datasetSplit: "development",
    dataClass: "fully_synthetic",
    caseIds: [...PHASE2_DEVELOPMENT_CASE_IDS],
    cases,
  };
  return Object.freeze({
    ...content,
    snapshotHash: hashCanonicalJson(content),
  });
}
