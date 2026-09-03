import { hashCanonicalJson } from "../validation/canonical-json.js";
import {
  hasExactKeys,
  isPlainObject,
  isRfc3339,
  PHASE2AO_ACTION_CARD_VERSION,
  PHASE2AO_HARNESS_POLICY_VERSION,
} from "./contracts.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const SYNTHETIC_EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/u;
const TOPICS = new Set([
  "academic_course",
  "payment_funding",
  "registration_status",
  "visa_identity",
  "exam_results",
  "account_security",
  "campus_activity",
  "housing_campus_life",
  "other_school_affairs",
]);
const FACT_STATES = new Set([
  "confirmed",
  "possible",
  "unconfirmed",
  "not_applicable",
]);
const CAPABILITY_KEYS = Object.freeze([
  "viewOriginal",
  "viewEvidence",
  "askFixedFollowups",
  "retryAnalysis",
  "openTrustedActionChannel",
  "previewCalendar",
  "writeCalendar",
  "markRead",
  "snooze",
  "markArranged",
  "markCompleted",
  "markIrrelevant",
  "correctClassification",
]);
const CAPABILITY_DECISION_SOURCES = Object.freeze([
  "harness_policy",
  "phase_boundary",
  "synthetic_fixture",
]);
const CAPABILITY_REASON_CODES = Object.freeze([
  "mock_only",
  "not_implemented",
  "not_connected",
  "user_confirmation_required",
  "analysis_pending",
  "candidate_invalid",
  "evidence_unconfirmed",
  "applicability_unconfirmed",
  "obligation_unconfirmed",
  "condition_unconfirmed",
  "date_missing",
  "date_unconfirmed",
  "date_conflict",
  "source_unverified",
  "source_suspicious",
  "action_channel_unverified",
  "security_conflict",
  "attachment_unparsed",
  "relation_ambiguous",
  "item_inactive",
  "version_superseded",
  "unsupported_for_item",
]);
const CAPABILITY_REASON_CODE_SET = new Set(CAPABILITY_REASON_CODES);
const ROOT_FIELDS = Object.freeze([
  "contractVersion",
  "synthetic",
  "notification",
  "provenance",
  "homeSection",
  "homeSectionExplanation",
  "homeSectionClaimRefs",
  "nativeImportanceSignals",
  "title",
  "titleClaimRefs",
  "summary",
  "summaryClaimRefs",
  "topics",
  "relevance",
  "sourceTrust",
  "informationCompleteness",
  "consequence",
  "mailActions",
  "managementSuggestions",
  "dates",
  "claims",
  "evidence",
  "risks",
  "unknowns",
  "relation",
  "states",
  "capabilityBinding",
  "capabilities",
]);

export const ACTION_CARD_V02_CONTRACT_DESCRIPTOR = Object.freeze({
  contractVersion: PHASE2AO_ACTION_CARD_VERSION,
  additionalProperties: false,
  rootFields: ROOT_FIELDS,
  provenanceModes: Object.freeze([
    "static_fixture",
    "synthetic_mock",
    "captured_replay",
    "live_model",
  ]),
  harnessPolicyVersion: PHASE2AO_HARNESS_POLICY_VERSION,
  capabilityKeys: CAPABILITY_KEYS,
  capabilityDecisionSources: CAPABILITY_DECISION_SOURCES,
  capabilityReasonCodes: CAPABILITY_REASON_CODES,
  collectionLimits: Object.freeze({
    relevanceBasis: 12,
    mailActions: 12,
    managementSuggestions: 8,
    dates: 12,
    claims: 64,
    evidence: 64,
  }),
});

export const ACTION_CARD_V02_CONTRACT_HASH =
  "sha256:6a4be413cae22a99dda58d88aff6fbc9c714cff859aacf0e455164b02ce640bd";
if (
  hashCanonicalJson(ACTION_CARD_V02_CONTRACT_DESCRIPTOR) !==
  ACTION_CARD_V02_CONTRACT_HASH
) {
  throw new TypeError("Action Card v0.2 contract drifted");
}

export const ACTION_CARD_V02_MANIFEST = Object.freeze({
  status: "active",
  contract_version: PHASE2AO_ACTION_CARD_VERSION,
  contract_hash_kind: "descriptor",
  contract_descriptor_hash: ACTION_CARD_V02_CONTRACT_HASH,
  validation_authority: "validateActionCardV02",
  harness_policy_version: PHASE2AO_HARNESS_POLICY_VERSION,
  additive_from: "action-card-view-model/v0.1",
});

export class Phase2aoActionCardValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Phase2aoActionCardValidationError";
    this.code = code;
  }
}

function fail(message) {
  throw new Phase2aoActionCardValidationError(
    "action_card_contract_invalid",
    message,
  );
}

function text(value, max = 1_500) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length >= 1 &&
    value.length <= max
  );
}

function identifier(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function identifierList(value, { min = 0, max = 64 } = {}) {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every(identifier) &&
    new Set(value).size === value.length
  );
}

function assertCapability(value, { preview = false } = {}) {
  const fields = preview
    ? ["state", "decisionSource", "reasonCodes", "message", "eligibleDateIds"]
    : ["state", "decisionSource", "reasonCodes", "message"];
  if (
    !hasExactKeys(value, fields) ||
    !["allowed", "blocked", "not_applicable", "unavailable"].includes(
      value.state,
    ) ||
    !CAPABILITY_DECISION_SOURCES.includes(value.decisionSource) ||
    !identifierList(value.reasonCodes, { max: 8 }) ||
    value.reasonCodes.some((code) => !CAPABILITY_REASON_CODE_SET.has(code)) ||
    (value.state === "allowed" &&
      (value.reasonCodes.length !== 0 || value.message !== null)) ||
    (value.state !== "allowed" &&
      (value.reasonCodes.length === 0 || !text(value.message, 500))) ||
    (preview && !identifierList(value.eligibleDateIds, { max: 12 })) ||
    (preview &&
      ((value.state === "allowed" && value.eligibleDateIds.length === 0) ||
        (value.state !== "allowed" && value.eligibleDateIds.length !== 0)))
  ) {
    fail("Action Card capability is invalid.");
  }
}

function assertNotification(value) {
  if (
    !hasExactKeys(value, [
      "id",
      "schoolName",
      "senderName",
      "senderAddress",
      "subject",
      "sentAt",
      "receivedAt",
      "language",
    ]) ||
    !identifier(value.id) ||
    !text(value.schoolName, 120) ||
    !text(value.senderName, 120) ||
    typeof value.senderAddress !== "string" ||
    !SYNTHETIC_EMAIL_PATTERN.test(value.senderAddress) ||
    !value.senderAddress.toLowerCase().endsWith(".invalid") ||
    !text(value.subject, 120) ||
    !isRfc3339(value.sentAt) ||
    !isRfc3339(value.receivedAt) ||
    Date.parse(value.receivedAt) < Date.parse(value.sentAt) ||
    !["en", "zh_hant", "zh_hans", "mixed"].includes(value.language)
  ) {
    fail("Action Card notification is invalid.");
  }
}

function assertProvenance(value) {
  if (
    !hasExactKeys(value, [
      "sourceMode",
      "harnessVerified",
      "analyzedAt",
      "disclosure",
    ]) ||
    !ACTION_CARD_V02_CONTRACT_DESCRIPTOR.provenanceModes.includes(
      value.sourceMode,
    ) ||
    typeof value.harnessVerified !== "boolean" ||
    !text(value.disclosure, 500)
  ) {
    fail("Action Card provenance is invalid.");
  }
  const isStatic = value.sourceMode === "static_fixture";
  if (
    (isStatic && (value.harnessVerified || value.analyzedAt !== null)) ||
    (!isStatic &&
      (!value.harnessVerified || !isRfc3339(value.analyzedAt)))
  ) {
    fail("Action Card provenance does not match its evidence mode.");
  }
}

function assertNativeImportance(signals) {
  const kinds = new Set();
  if (!Array.isArray(signals) || signals.length !== 3) {
    fail("Action Card must contain all three native importance signals.");
  }
  for (const signal of signals) {
    if (
      !hasExactKeys(signal, ["kind", "state", "protection"]) ||
      !["sender_importance", "provider_importance", "user_star"].includes(
        signal.kind,
      ) ||
      !["present", "absent", "unknown"].includes(signal.state) ||
      ![
        "active",
        "released_by_user",
        "released_by_approved_rule",
        "not_applicable",
        "unknown",
      ].includes(signal.protection) ||
      (signal.state === "absent" && signal.protection !== "not_applicable") ||
      (signal.state === "unknown" && signal.protection !== "unknown") ||
      (signal.state === "present" &&
        ["not_applicable", "unknown"].includes(signal.protection)) ||
      (signal.kind === "user_star" &&
        signal.state === "present" &&
        signal.protection !== "active")
    ) {
      fail("A native importance signal is invalid.");
    }
    kinds.add(signal.kind);
  }
  if (kinds.size !== 3) fail("Native importance signal kinds must be unique.");
}

function assertEvidenceAndClaims(card) {
  if (card.evidence.length > 64 || card.claims.length > 64) {
    fail("Action Card evidence or Claim collection exceeds its contract limit.");
  }
  const evidenceIds = new Set();
  for (const evidence of card.evidence) {
    if (
      !hasExactKeys(evidence, ["id", "quote", "location"]) ||
      !identifier(evidence.id) ||
      evidenceIds.has(evidence.id) ||
      !text(evidence.quote) ||
      !hasExactKeys(evidence.location, ["kind"]) ||
      evidence.location.kind !== "body"
    ) {
      fail("Action Card evidence is invalid.");
    }
    evidenceIds.add(evidence.id);
  }

  const claimById = new Map();
  for (const claim of card.claims) {
    if (
      !hasExactKeys(claim, [
        "id",
        "kind",
        "text",
        "highImpact",
        "factState",
        "evidenceIds",
      ]) ||
      !identifier(claim.id) ||
      claimById.has(claim.id) ||
      ![
        "summary",
        "applicability",
        "action",
        "date",
        "consequence",
        "risk",
        "update",
        "other",
      ].includes(claim.kind) ||
      !text(claim.text) ||
      typeof claim.highImpact !== "boolean" ||
      !FACT_STATES.has(claim.factState) ||
      !identifierList(claim.evidenceIds, { min: 1 }) ||
      claim.evidenceIds.some((id) => !evidenceIds.has(id))
    ) {
      fail("Action Card claim is invalid.");
    }
    claimById.set(claim.id, claim);
  }

  const assertClaimRefs = (refs, kinds = null, minimum = 0) => {
    if (!identifierList(refs, { min: minimum })) fail("Claim references are invalid.");
    for (const ref of refs) {
      const claim = claimById.get(ref);
      if (
        claim === undefined ||
        claim.factState !== "confirmed" ||
        (kinds !== null && !kinds.includes(claim.kind))
      ) {
        fail("A Claim reference does not resolve to an allowed confirmed Claim.");
      }
    }
  };

  assertClaimRefs(card.titleClaimRefs, null, 1);
  assertClaimRefs(card.summaryClaimRefs, null, 1);
  assertClaimRefs(card.homeSectionClaimRefs, null, 1);
  return { claimById, assertClaimRefs };
}

function assertRelevance(card, assertClaimRefs) {
  const relevance = card.relevance;
  if (
    !hasExactKeys(relevance, ["scope", "factState", "explanation", "basis"]) ||
    ![
      "self",
      "confirmed_course",
      "program",
      "cohort",
      "faculty",
      "schoolwide",
      "undetermined",
      "not_applicable",
    ].includes(relevance.scope) ||
    !FACT_STATES.has(relevance.factState) ||
    !text(relevance.explanation, 500) ||
    !Array.isArray(relevance.basis) ||
    relevance.basis.length < 1 ||
    relevance.basis.length > 12
  ) {
    fail("Action Card relevance is invalid.");
  }
  let confirmedProfile = false;
  for (const basis of relevance.basis) {
    if (
      !hasExactKeys(basis, ["id", "kind", "label", "profileState", "claimRefs"]) ||
      !identifier(basis.id) ||
      basis.kind !== "profile_field" ||
      !text(basis.label, 120) ||
      !["confirmed", "candidate", "expired", "removed"].includes(
        basis.profileState,
      )
    ) {
      fail("Action Card relevance basis is invalid.");
    }
    assertClaimRefs(basis.claimRefs, ["applicability"], 1);
    confirmedProfile ||= basis.profileState === "confirmed";
  }
  if (
    ["confirmed_course", "program", "cohort", "faculty"].includes(
      relevance.scope,
    ) &&
    relevance.factState === "confirmed" &&
    !confirmedProfile
  ) {
    fail("Confirmed course relevance requires confirmed profile evidence.");
  }
}

function assertActionsAndDates(card, assertClaimRefs) {
  if (card.mailActions.length > 12 || card.dates.length > 12) {
    fail("Action Card action or date collection exceeds its contract limit.");
  }
  const actionIds = new Set();
  for (const action of card.mailActions) {
    if (
      !hasExactKeys(action, [
        "id",
        "origin",
        "actor",
        "action",
        "object",
        "displayText",
        "obligation",
        "factState",
        "condition",
        "claimRefs",
      ]) ||
      !identifier(action.id) ||
      actionIds.has(action.id) ||
      action.origin !== "mail" ||
      !text(action.actor, 120) ||
      !text(action.action, 120) ||
      !text(action.object, 120) ||
      !text(action.displayText, 500) ||
      !["mandatory", "recommended", "optional"].includes(action.obligation) ||
      action.factState !== "confirmed" ||
      action.condition !== null
    ) {
      fail("Action Card mail action is invalid.");
    }
    assertClaimRefs(action.claimRefs, ["action"], 1);
    actionIds.add(action.id);
  }

  const eligibleDates = [];
  const dateIds = new Set();
  for (const date of card.dates) {
    if (
      !hasExactKeys(date, [
        "id",
        "role",
        "originalText",
        "factState",
        "normalized",
        "linkedActionIds",
        "claimRefs",
        "calendarEligibility",
      ]) ||
      !identifier(date.id) ||
      dateIds.has(date.id) ||
      ![
        "payment_deadline",
        "registration_deadline",
        "submission_deadline",
        "other_deadline",
      ].includes(date.role) ||
      !text(date.originalText, 120) ||
      date.factState !== "confirmed" ||
      !hasExactKeys(date.normalized, ["kind", "value", "timeZone"]) ||
      date.normalized.kind !== "date_time" ||
      !isRfc3339(date.normalized.value) ||
      !date.normalized.value.endsWith("+08:00") ||
      date.normalized.timeZone !== "Asia/Hong_Kong" ||
      !identifierList(date.linkedActionIds, { min: 1, max: 12 }) ||
      date.linkedActionIds.some((id) => !actionIds.has(id)) ||
      !hasExactKeys(date.calendarEligibility, [
        "eligible",
        "blockedReasonCode",
      ]) ||
      typeof date.calendarEligibility.eligible !== "boolean" ||
      (date.calendarEligibility.eligible
        ? date.calendarEligibility.blockedReasonCode !== null
        : !identifier(date.calendarEligibility.blockedReasonCode))
    ) {
      fail("Action Card date is invalid.");
    }
    dateIds.add(date.id);
    assertClaimRefs(date.claimRefs, ["date"], 1);
    if (date.calendarEligibility.eligible) eligibleDates.push(date.id);
  }
  return eligibleDates.sort();
}

function assertStaticCollections(card, assertClaimRefs) {
  if (
    !Array.isArray(card.managementSuggestions) ||
    card.managementSuggestions.length > 8
  ) {
    fail("Management suggestions are invalid.");
  }
  const suggestionIds = new Set();
  for (const suggestion of card.managementSuggestions) {
    if (
      !hasExactKeys(suggestion, [
        "id",
        "origin",
        "safetyClass",
        "text",
        "reason",
        "claimRefs",
      ]) ||
      !identifier(suggestion.id) ||
      suggestionIds.has(suggestion.id) ||
      suggestion.origin !== "ai_management_suggestion" ||
      suggestion.safetyClass !== "low_risk_personal_management" ||
      !text(suggestion.text, 500) ||
      !text(suggestion.reason, 500)
    ) {
      fail("A management suggestion is invalid.");
    }
    suggestionIds.add(suggestion.id);
    assertClaimRefs(suggestion.claimRefs, null, 1);
  }
  if (!Array.isArray(card.risks) || card.risks.length !== 0) {
    fail("Phase 2A-O DEV001 must not invent risks.");
  }
  if (!Array.isArray(card.unknowns) || card.unknowns.length !== 0) {
    fail("Phase 2A-O DEV001 must not invent unknowns.");
  }
}

function assertEntityIdsAreGloballyUnique(card) {
  const ids = [
    ...card.relevance.basis.map(({ id }) => id),
    ...card.mailActions.map(({ id }) => id),
    ...card.managementSuggestions.map(({ id }) => id),
    ...card.dates.map(({ id }) => id),
    ...card.claims.map(({ id }) => id),
    ...card.evidence.map(({ id }) => id),
    ...card.risks.map(({ id }) => id),
  ];
  if (new Set(ids).size !== ids.length) {
    fail("Action Card entity IDs must be globally unique.");
  }
}

/** Strictly accept the complete Action Card v0.2 by identity; never repair it. */
export function validateActionCardV02(card) {
  if (
    !hasExactKeys(card, ROOT_FIELDS) ||
    card.contractVersion !== PHASE2AO_ACTION_CARD_VERSION ||
    card.synthetic !== true
  ) {
    fail("Action Card v0.2 root contract is invalid.");
  }
  assertNotification(card.notification);
  assertProvenance(card.provenance);
  assertNativeImportance(card.nativeImportanceSignals);
  if (
    !["action_required", "priority_reading", "other"].includes(
      card.homeSection,
    ) ||
    !text(card.homeSectionExplanation, 500) ||
    !text(card.title, 120) ||
    !text(card.summary, 800) ||
    !Array.isArray(card.topics) ||
    card.topics.length < 1 ||
    card.topics.some((topic) => !TOPICS.has(topic)) ||
    new Set(card.topics).size !== card.topics.length
  ) {
    fail("Action Card presentation fields are invalid.");
  }
  if (
    !Array.isArray(card.claims) ||
    card.claims.length < 1 ||
    !Array.isArray(card.evidence) ||
    card.evidence.length < 1 ||
    !Array.isArray(card.mailActions) ||
    !Array.isArray(card.dates)
  ) {
    fail("Action Card graph collections are invalid.");
  }
  const { assertClaimRefs } = assertEvidenceAndClaims(card);
  assertRelevance(card, assertClaimRefs);
  const eligibleDates = assertActionsAndDates(card, assertClaimRefs);
  assertStaticCollections(card, assertClaimRefs);
  assertEntityIdsAreGloballyUnique(card);

  if (
    !hasExactKeys(card.sourceTrust, [
      "sourceStatus",
      "actionChannelStatus",
      "reason",
    ]) ||
    !["official_verified", "unverified", "suspicious", "unknown"].includes(
      card.sourceTrust.sourceStatus,
    ) ||
    !["verified", "unverified", "suspicious", "not_required", "unknown"].includes(
      card.sourceTrust.actionChannelStatus,
    ) ||
    !text(card.sourceTrust.reason, 500) ||
    !hasExactKeys(card.informationCompleteness, ["status", "gaps"]) ||
    card.informationCompleteness.status !== "complete" ||
    !Array.isArray(card.informationCompleteness.gaps) ||
    card.informationCompleteness.gaps.length !== 0 ||
    !hasExactKeys(card.consequence, [
      "level",
      "factState",
      "reason",
      "highConsequenceClue",
      "claimRefs",
    ]) ||
    !["high", "medium", "low", "unknown"].includes(card.consequence.level) ||
    card.consequence.factState !== "confirmed" ||
    !text(card.consequence.reason, 500) ||
    typeof card.consequence.highConsequenceClue !== "boolean"
  ) {
    fail("Action Card trust, completeness, or consequence is invalid.");
  }
  assertClaimRefs(card.consequence.claimRefs, ["consequence"], 1);

  if (
    !hasExactKeys(card.relation, [
      "disposition",
      "matchState",
      "relatedItemId",
      "explanation",
    ]) ||
    card.relation.disposition !== "new_item" ||
    card.relation.matchState !== "not_applicable" ||
    card.relation.relatedItemId !== null ||
    !text(card.relation.explanation, 500) ||
    !hasExactKeys(card.states, [
      "read",
      "management",
      "item",
      "visibility",
      "due",
      "version",
      "updateKind",
      "previousVersionId",
      "supersededByVersionId",
      "mergedIntoId",
    ]) ||
    card.states.read !== "unread" ||
    card.states.management !== "active" ||
    card.states.item !== "active" ||
    card.states.visibility !== "active" ||
    !["upcoming", "due_soon", "overdue"].includes(card.states.due) ||
    card.states.version !== "current" ||
    card.states.updateKind !== "none" ||
    card.states.previousVersionId !== null ||
    card.states.supersededByVersionId !== null ||
    card.states.mergedIntoId !== null
  ) {
    fail("Action Card relation or lifecycle state is invalid.");
  }

  if (
    !hasExactKeys(card.capabilityBinding, [
      "viewModelVersion",
      "harnessPolicyVersion",
      "itemVersion",
    ]) ||
    card.capabilityBinding.viewModelVersion !== PHASE2AO_ACTION_CARD_VERSION ||
    card.capabilityBinding.harnessPolicyVersion !==
      PHASE2AO_HARNESS_POLICY_VERSION ||
    !identifier(card.capabilityBinding.itemVersion) ||
    !hasExactKeys(card.capabilities, CAPABILITY_KEYS)
  ) {
    fail("Action Card capability binding is invalid.");
  }
  for (const key of CAPABILITY_KEYS) {
    assertCapability(card.capabilities[key], {
      preview: key === "previewCalendar",
    });
  }
  if (card.capabilities.writeCalendar.state === "allowed") {
    fail("Phase 2A-O must never allow real calendar writes.");
  }
  const capabilityDates = [
    ...card.capabilities.previewCalendar.eligibleDateIds,
  ].sort();
  if (
    eligibleDates.length !== capabilityDates.length ||
    eligibleDates.some((id, index) => id !== capabilityDates[index]) ||
    (eligibleDates.length > 0) !==
      (card.capabilities.previewCalendar.state === "allowed")
  ) {
    fail("Calendar preview capability does not match eligible dates.");
  }

  const scopeRequiresConfirmedProfile = [
    "confirmed_course",
    "program",
    "cohort",
    "faculty",
  ].includes(card.relevance.scope);
  const hasConfirmedProfileBasis = card.relevance.basis.some(
    (basis) =>
      basis.kind === "profile_field" && basis.profileState === "confirmed",
  );
  const hasTrustedApplicabilityBasis =
    hasConfirmedProfileBasis &&
    (!scopeRequiresConfirmedProfile || hasConfirmedProfileBasis);
  const requiredAction = card.mailActions.some(
    (action) =>
      action.factState === "confirmed" && action.obligation === "mandatory",
  );
  const qualifiesForAction =
    requiredAction &&
    card.relevance.factState === "confirmed" &&
    !["undetermined", "not_applicable"].includes(card.relevance.scope) &&
    hasTrustedApplicabilityBasis &&
    card.sourceTrust.sourceStatus === "official_verified" &&
    ["verified", "not_required"].includes(
      card.sourceTrust.actionChannelStatus,
    );
  if ((card.homeSection === "action_required") !== qualifiesForAction) {
    fail("Action Card home section did not follow the Harness safety gate.");
  }

  if (card.homeSection === "other") {
    const hasNativeProtection = card.nativeImportanceSignals.some(
      (signal) =>
        (signal.state === "present" && signal.protection === "active") ||
        signal.state === "unknown",
    );
    const hasConsequenceProtection =
      ["high", "medium"].includes(card.consequence.level) ||
      (card.consequence.level === "unknown" &&
        card.consequence.highConsequenceClue);
    const hasSafetyProtection =
      card.sourceTrust.sourceStatus === "suspicious" ||
      card.sourceTrust.actionChannelStatus === "suspicious";
    const hasAcademicProtection =
      ["confirmed", "possible", "unconfirmed"].includes(
        card.relevance.factState,
      ) &&
      ["self", "confirmed_course", "program", "cohort", "faculty"].includes(
        card.relevance.scope,
      ) &&
      card.topics.includes("academic_course");
    const hasCriticalUpdate = card.claims.some(
      (claim) =>
        claim.kind === "update" &&
        ["confirmed", "possible", "unconfirmed"].includes(claim.factState) &&
        claim.highImpact,
    );
    const hasRequiredAction = card.mailActions.some(
      (action) =>
        action.obligation === "mandatory" &&
        action.factState !== "not_applicable",
    );
    if (
      hasNativeProtection ||
      hasConsequenceProtection ||
      hasSafetyProtection ||
      hasAcademicProtection ||
      hasCriticalUpdate ||
      hasRequiredAction
    ) {
      fail("Protected DEV001 content cannot be placed in the other section.");
    }
  }

  const calendarSafetyGate =
    card.relevance.factState === "confirmed" &&
    card.sourceTrust.sourceStatus === "official_verified" &&
    ["verified", "not_required"].includes(
      card.sourceTrust.actionChannelStatus,
    );
  if (eligibleDates.length > 0 && !calendarSafetyGate) {
    fail("Calendar eligibility did not follow the Harness safety gate.");
  }
  if (
    card.capabilities.openTrustedActionChannel.state === "allowed" &&
    (card.sourceTrust.sourceStatus !== "official_verified" ||
      card.sourceTrust.actionChannelStatus !== "verified" ||
      card.mailActions.length === 0)
  ) {
    fail("Trusted action-channel capability did not follow its safety gate.");
  }
  return card;
}

export function freezeJson(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeJson(child);
  }
  return value;
}

export function jsonClone(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    fail("Only JSON objects or arrays can be cloned.");
  }
  return structuredClone(value);
}
