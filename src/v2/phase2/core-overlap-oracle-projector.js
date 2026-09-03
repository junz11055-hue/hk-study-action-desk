export const PHASE2_CORE_OVERLAP_ORACLE_VERSION =
  "phase2-core-overlap-oracle-v1";

export const PHASE2_CORE_OVERLAP_CASE_IDS = Object.freeze([
  "DEV001",
  "DEV003",
  "DEV004",
  "DEV005",
  "DEV006",
  "DEV007",
  "DEV008",
  "DEV010",
  "DEV017",
  "DEV018",
  "DEV019",
  "DEV020",
  "DEV022",
  "DEV023",
  "DEV024",
  "DEV025",
]);

const CASE_ID_ALLOWLIST = new Set(PHASE2_CORE_OVERLAP_CASE_IDS);
const HAN_PATTERN = /\p{Script=Han}/u;

const EXPECTED_ROOT_KEYS = Object.freeze([
  "action_channel_status",
  "actions",
  "applicability",
  "blocked_capabilities",
  "calendar_eligible",
  "claims",
  "consequence",
  "dates",
  "evidence",
  "fact_states",
  "incoming_disposition",
  "labels",
  "management_suggestions",
  "north_star_eligible",
  "north_star_maturity_status",
  "notification_channel",
  "protection_result",
  "relation_truth_id",
  "resulting_item",
  "source_mode",
  "source_status",
  "source_truth_id",
  "topics",
  "uncertainties",
]);
const TOPIC_KEYS = Object.freeze(["evidence_ids", "label"]);
const APPLICABILITY_KEYS = Object.freeze([
  "applicability_claim_id",
  "evidence_ids",
  "fact_state",
  "gaps",
  "profile_field_refs",
  "reason",
  "scope",
  "value",
]);
const ACTION_KEYS = Object.freeze([
  "action_id",
  "actor",
  "claim_refs",
  "condition",
  "condition_basis_refs",
  "condition_claim_refs",
  "condition_status",
  "fact_state",
  "materials",
  "object",
  "obligation",
  "verb",
]);
const CONDITION_BASIS_KEYS = Object.freeze([
  "confirmation_status",
  "profile_field_id",
  "source",
  "value",
]);
const CONDITION_BASIS_COURSE_KEYS = Object.freeze([
  ...CONDITION_BASIS_KEYS,
  "course_status",
]);
const CONDITION_BASIS_ALIAS_KEYS = Object.freeze([
  ...CONDITION_BASIS_KEYS,
  "matched_alias",
]);
const DATE_KEYS = Object.freeze([
  "calendar_candidate",
  "claim_id",
  "conflict",
  "date_id",
  "evidence_ids",
  "fact_state",
  "normalized",
  "original_text",
  "role",
  "timezone",
]);
const CONSEQUENCE_KEYS = Object.freeze([
  "claim_id",
  "consequence_sort_bucket",
  "evidence_ids",
  "fact_state",
  "level",
  "reason",
  "truth_id",
  "unknown_with_high_consequence_clue",
]);
const CLAIM_KEYS = Object.freeze([
  "claim_id",
  "evidence_ids",
  "fact_state",
  "high_impact",
  "text",
  "type",
]);
const BODY_EVIDENCE_KEYS = Object.freeze([
  "evidence_id",
  "locator",
  "quote",
  "source",
]);

const DIRECT_DEADLINE_ROLE_MAP = Object.freeze({
  registration_deadline: "registration_deadline",
  submission_deadline: "submission_deadline",
  optional_registration_deadline: "registration_deadline",
  attendance_deadline: "other_deadline",
  confirmation_deadline: "other_deadline",
  upload_deadline: "other_deadline",
});

const EXCLUDED_DATE_ROLES = new Set([
  "event_start",
  "event_end",
  "maintenance_start",
  "maintenance_end",
  "maintenance_window_start",
  "maintenance_window_end",
  "window_start",
  "window_end",
]);

const ROOT_EXCLUSIONS = Object.freeze([
  ["incoming_disposition", "harness_owned", "由后续产品 Harness 裁决。"],
  ["protection_result", "harness_owned", "原生重要保护不属于 Core Candidate。"],
  ["source_truth_id", "harness_owned", "来源认证不属于 Phase 2。"],
  ["source_status", "harness_owned", "来源认证不属于 Phase 2。"],
  ["action_channel_status", "harness_owned", "行动渠道认证不属于 Phase 2。"],
  ["relation_truth_id", "harness_owned", "通知关系不属于 Phase 2。"],
  ["labels", "harness_owned", "产品标签不等同于 Core topics。"],
  ["evidence", "validated_elsewhere", "quote 闭合由 Core Validator 和人工语义复核负责。"],
  ["claims", "manual_review_only", "claim 完整性和证据语义由人工复核负责。"],
  ["management_suggestions", "harness_owned", "管理建议不属于 Core Candidate。"],
  ["uncertainties", "not_expressible_in_core_v2", "Core v2 没有 uncertainties 合同。"],
  ["fact_states", "harness_owned", "事实状态不属于 Core Candidate。"],
  ["resulting_item", "harness_owned", "首页和生命周期状态由 Harness 裁决。"],
  ["notification_channel", "harness_owned", "通知渠道不属于 Phase 2。"],
  ["calendar_eligible", "harness_owned", "日历资格不属于 Phase 2。"],
  ["north_star_eligible", "harness_owned", "北极星口径不属于 Core Candidate。"],
  ["north_star_maturity_status", "harness_owned", "北极星口径不属于 Core Candidate。"],
  ["blocked_capabilities", "harness_owned", "能力阻断由 Harness 裁决。"],
  ["source_mode", "evaluation_metadata", "夹具来源元数据不进入 Candidate。"],
]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function sameKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...expectedKeys].sort(compareStrings);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function assertExactKeys(value, expectedKeys, label) {
  if (!sameKeys(value, expectedKeys)) {
    throw new TypeError(`${label} contains an unknown, missing, or uncovered field`);
  }
}

function assertUniqueIds(items, idKey, label) {
  if (!Array.isArray(items)) throw new TypeError(`${label} must be an array`);
  const ids = items.map((item, index) => {
    if (!isPlainObject(item) || typeof item[idKey] !== "string") {
      throw new TypeError(`${label}[${index}] is invalid`);
    }
    return item[idKey];
  });
  if (new Set(ids).size !== ids.length) {
    throw new TypeError(`${label} contains duplicate ${idKey} values`);
  }
}

function assertExpectedCoverage(expected) {
  assertExactKeys(expected, EXPECTED_ROOT_KEYS, "expected");

  if (!Array.isArray(expected.topics) || expected.topics.length === 0) {
    throw new TypeError("expected.topics must be a non-empty array");
  }
  expected.topics.forEach((topic, index) =>
    assertExactKeys(topic, TOPIC_KEYS, `expected.topics[${index}]`),
  );
  const topicLabels = expected.topics.map(({ label }) => label);
  if (new Set(topicLabels).size !== topicLabels.length) {
    throw new TypeError("expected.topics contains duplicate labels");
  }

  assertExactKeys(
    expected.applicability,
    APPLICABILITY_KEYS,
    "expected.applicability",
  );
  if (!Array.isArray(expected.applicability.profile_field_refs)) {
    throw new TypeError("expected.applicability.profile_field_refs must be an array");
  }
  if (
    new Set(expected.applicability.profile_field_refs).size !==
    expected.applicability.profile_field_refs.length
  ) {
    throw new TypeError("expected.applicability.profile_field_refs contains duplicates");
  }

  assertUniqueIds(expected.actions, "action_id", "expected.actions");
  expected.actions.forEach((action, index) => {
    assertExactKeys(action, ACTION_KEYS, `expected.actions[${index}]`);
    if (!Array.isArray(action.condition_basis_refs)) {
      throw new TypeError(`expected.actions[${index}].condition_basis_refs must be an array`);
    }
    action.condition_basis_refs.forEach((basis, basisIndex) => {
      const keys = Object.hasOwn(basis, "course_status")
        ? CONDITION_BASIS_COURSE_KEYS
        : Object.hasOwn(basis, "matched_alias")
          ? CONDITION_BASIS_ALIAS_KEYS
          : CONDITION_BASIS_KEYS;
      assertExactKeys(
        basis,
        keys,
        `expected.actions[${index}].condition_basis_refs[${basisIndex}]`,
      );
    });
  });

  assertUniqueIds(expected.dates, "date_id", "expected.dates");
  expected.dates.forEach((date, index) =>
    assertExactKeys(date, DATE_KEYS, `expected.dates[${index}]`),
  );
  assertExactKeys(expected.consequence, CONSEQUENCE_KEYS, "expected.consequence");

  assertUniqueIds(expected.claims, "claim_id", "expected.claims");
  expected.claims.forEach((claim, index) =>
    assertExactKeys(claim, CLAIM_KEYS, `expected.claims[${index}]`),
  );
  assertUniqueIds(expected.evidence, "evidence_id", "expected.evidence");
  expected.evidence.forEach((evidence, index) => {
    assertExactKeys(evidence, BODY_EVIDENCE_KEYS, `expected.evidence[${index}]`);
    if (evidence.source !== "body") {
      throw new TypeError("the frozen Phase 2 subset only permits body evidence");
    }
  });
}

function assertDevelopmentCase(developmentCase) {
  if (!isPlainObject(developmentCase)) {
    throw new TypeError("developmentCase must be a plain object");
  }
  if (!CASE_ID_ALLOWLIST.has(developmentCase.case_id)) {
    throw new RangeError("developmentCase is outside the frozen Phase 2 allowlist");
  }
  if (
    developmentCase.dataset_split !== "development" ||
    !isPlainObject(developmentCase.expected) ||
    !isPlainObject(developmentCase.input) ||
    !isPlainObject(developmentCase.input.message)
  ) {
    throw new TypeError("developmentCase does not match the development fixture contract");
  }
  assertExpectedCoverage(developmentCase.expected);
  return developmentCase.expected;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSortedStrings(values) {
  return [...new Set(values)].sort(compareStrings);
}

function indexExpectedClaims(expected) {
  return new Map(expected.claims.map((claim) => [claim.claim_id, claim]));
}

function highImpactForClaimRefs(claimsById, claimIds, label) {
  let highImpact = false;
  for (const claimId of claimIds.filter((value) => value !== null)) {
    const claim = claimsById.get(claimId);
    if (!claim) throw new TypeError(`${label} contains an unknown claim reference`);
    highImpact ||= claim.high_impact === true;
  }
  return highImpact;
}

function mapActionObligation(action) {
  if (action.obligation === "conditional_mandatory") {
    // Core actions describe the obligation stated by the message. Whether the
    // current user meets that condition is scored independently as applicability.
    if (action.condition_status !== "met" && action.condition_status !== "unmet") {
      throw new TypeError("conditional_mandatory action has an unsupported condition_status");
    }
    return "mandatory";
  }
  if (["mandatory", "recommended", "optional"].includes(action.obligation)) {
    return action.obligation;
  }
  throw new TypeError("action obligation cannot be represented by Core v2");
}

function mapDeadlineRole(date, topicLabels) {
  const directlyMapped = DIRECT_DEADLINE_ROLE_MAP[date.role];
  if (directlyMapped) {
    return { coreRole: directlyMapped, exclusionReason: null };
  }

  if (date.role === "deadline") {
    if (topicLabels.includes("缴费与资助")) {
      return { coreRole: "payment_deadline", exclusionReason: null };
    }
    if (topicLabels.includes("专业与课程")) {
      return { coreRole: "submission_deadline", exclusionReason: null };
    }
    return {
      coreRole: null,
      exclusionReason: "普通 deadline 无法按冻结的缴费或作业口径确定 Core role。",
    };
  }

  if (EXCLUDED_DATE_ROLES.has(date.role)) {
    return {
      coreRole: null,
      exclusionReason: "事件、维护或时间窗口不是 Core deadline。",
    };
  }

  return {
    coreRole: null,
    exclusionReason: "该 development date role 不在冻结的 Core deadline 映射中。",
  };
}

function addExcluded(entries, path, reasonCode, reason) {
  const key = `${path}\u0000${reasonCode}`;
  if (!entries.has(key)) {
    entries.set(key, { path, reason_code: reasonCode, reason });
  }
}

function buildExcludedFields(expected, deadlineDecisions) {
  const entries = new Map();

  for (const [field, reasonCode, reason] of ROOT_EXCLUSIONS) {
    if (Object.hasOwn(expected, field)) {
      addExcluded(entries, `/expected/${field}`, reasonCode, reason);
    }
  }

  addExcluded(
    entries,
    "/expected/topics/*/evidence_ids",
    "validated_elsewhere",
    "topic 的 claim/evidence 闭合由 Validator 与人工复核负责。",
  );

  for (const [field, reasonCode, reason] of [
    ["scope", "not_scored_core_overlap", "development scope 与 Core scope 不是完整同构，本阶段不计分。"],
    ["fact_state", "harness_owned", "事实状态不属于 Core Candidate。"],
    ["reason", "manual_review_only", "适用性理由的语义由人工复核。"],
    ["applicability_claim_id", "id_ignored", "Evaluator 忽略模型自建 ID。"],
    ["evidence_ids", "validated_elsewhere", "证据闭合由 Validator 与人工复核。"],
    ["gaps", "not_expressible_in_core_v2", "Core v2 没有细粒度 applicability gaps。"],
  ]) {
    if (Object.hasOwn(expected.applicability ?? {}, field)) {
      addExcluded(entries, `/expected/applicability/${field}`, reasonCode, reason);
    }
  }

  const actionExclusions = [
    ["action_id", "id_ignored", "Evaluator 忽略模型自建 ID。"],
    ["actor", "manual_review_only", "actor 语义等价性由人工复核。"],
    ["verb", "manual_review_only", "verb 语义等价性由人工复核。"],
    ["object", "manual_review_only", "object 语义等价性由人工复核。"],
    ["condition", "not_expressible_in_core_v2", "Core action 没有 condition 字段。"],
    ["materials", "not_expressible_in_core_v2", "Core action 没有 materials 字段。"],
    ["condition_status", "scored_via_applicability", "条件是否满足由 applicability.value 单独评分。"],
    ["condition_claim_refs", "not_expressible_in_core_v2", "Core action 没有 condition claim 合同。"],
    ["condition_basis_refs", "scored_via_applicability", "条件画像依据由 applicability.profile_field_ids 单独评分。"],
    ["claim_refs", "validated_elsewhere", "action claim 闭合由 Validator 与人工复核。"],
    ["fact_state", "harness_owned", "事实状态不属于 Core Candidate。"],
  ];
  if ((expected.actions ?? []).length > 0) {
    for (const [field, reasonCode, reason] of actionExclusions) {
      addExcluded(entries, `/expected/actions/*/${field}`, reasonCode, reason);
    }
  }

  for (const decision of deadlineDecisions) {
    if (!decision.coreRole) {
      addExcluded(
        entries,
        `/expected/dates/role=${decision.date.role}`,
        "not_a_core_deadline",
        decision.exclusionReason,
      );
    }
  }
  if (deadlineDecisions.some((decision) => decision.coreRole)) {
    for (const [field, reasonCode, reason] of [
      ["date_id", "id_ignored", "Evaluator 忽略模型自建 ID。"],
      ["normalized", "harness_owned", "Core v2 不归一化日期。"],
      ["timezone", "harness_owned", "Core v2 不裁决时区。"],
      ["conflict", "harness_owned", "日期冲突由后续 Harness 处理。"],
      ["calendar_candidate", "harness_owned", "日历候选资格不属于 Phase 2。"],
      ["claim_id", "id_ignored", "Evaluator 忽略模型自建 ID。"],
      ["evidence_ids", "validated_elsewhere", "deadline 证据闭合由 Validator 负责。"],
      ["fact_state", "harness_owned", "事实状态不属于 Core Candidate。"],
    ]) {
      addExcluded(entries, `/expected/dates/scored/${field}`, reasonCode, reason);
    }
  }

  for (const [field, reasonCode, reason] of [
    ["reason", "manual_review_only", "后果理由语义由人工复核。"],
    ["claim_id", "id_ignored", "Evaluator 忽略模型自建 ID。"],
    ["evidence_ids", "validated_elsewhere", "后果证据闭合由 Validator 与人工复核。"],
    ["unknown_with_high_consequence_clue", "harness_owned", "高后果未知线索由后续 Harness 处理。"],
    ["consequence_sort_bucket", "harness_owned", "排序桶由后续 Harness 处理。"],
    ["fact_state", "harness_owned", "事实状态不属于 Core Candidate。"],
    ["truth_id", "evaluation_metadata", "truth ID 不进入 Candidate。"],
  ]) {
    if (Object.hasOwn(expected.consequence ?? {}, field)) {
      addExcluded(entries, `/expected/consequence/${field}`, reasonCode, reason);
    }
  }

  return [...entries.values()].sort((left, right) => {
    return (
      compareStrings(left.path, right.path) ||
      compareStrings(left.reason_code, right.reason_code)
    );
  });
}

/**
 * Project a visible development fixture's expected value into the semantic
 * atoms that Core Candidate v2 can express and Phase 2 scores automatically.
 * This module is evaluation-only and must never be imported by a model path.
 */
export function projectCoreOverlapOracle(developmentCase) {
  const expected = assertDevelopmentCase(developmentCase);
  const claimsById = indexExpectedClaims(expected);
  const topicLabels = uniqueSortedStrings(
    (expected.topics ?? []).map((topic) => topic.label),
  );

  const actions = (expected.actions ?? [])
    .map((action, index) => ({
      obligation: mapActionObligation(action),
      high_impact: highImpactForClaimRefs(
        claimsById,
        action.claim_refs,
        `expected.actions[${index}].claim_refs`,
      ),
    }))
    .sort((left, right) =>
      compareStrings(
        `${left.obligation}\u0000${left.high_impact}`,
        `${right.obligation}\u0000${right.high_impact}`,
      ),
    );

  const deadlineDecisions = (expected.dates ?? []).map((date, index) => ({
    date,
    highImpact: highImpactForClaimRefs(
      claimsById,
      [date.claim_id],
      `expected.dates[${index}].claim_id`,
    ),
    ...mapDeadlineRole(date, topicLabels),
  }));
  const deadlines = deadlineDecisions
    .filter((decision) => decision.coreRole)
    .map((decision) => ({
      original_text: decision.date.original_text,
      role: decision.coreRole,
      high_impact: decision.highImpact,
    }))
    .sort((left, right) =>
      compareStrings(
        `${left.original_text}\u0000${left.role}\u0000${left.high_impact}`,
        `${right.original_text}\u0000${right.role}\u0000${right.high_impact}`,
      ),
    );

  const oracle = {
    oracle_version: PHASE2_CORE_OVERLAP_ORACLE_VERSION,
    case_id: developmentCase.case_id,
    split: "development",
    topics: topicLabels,
    applicability: {
      value: expected.applicability.value,
      profile_field_ids: uniqueSortedStrings(
        expected.applicability.profile_field_refs ?? [],
      ),
      high_impact: highImpactForClaimRefs(
        claimsById,
        [expected.applicability.applicability_claim_id],
        "expected.applicability.applicability_claim_id",
      ),
    },
    actions,
    deadlines,
    consequence: {
      level: expected.consequence.level,
      high_impact:
        expected.consequence.level === "high" ||
        highImpactForClaimRefs(
          claimsById,
          [expected.consequence.claim_id],
          "expected.consequence.claim_id",
        ),
    },
    excluded_fields: buildExcludedFields(expected, deadlineDecisions),
  };

  return deepFreeze(oracle);
}

function ensureHan(value, prefix, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("reference Candidate text must be a non-empty string");
  }
  const text = value.trim();
  const withHan = HAN_PATTERN.test(text) ? text : `${prefix}${text}`;
  if (withHan.length > maxLength) {
    throw new TypeError("reference Candidate text exceeds the Core bound");
  }
  return withHan;
}

function mapApplicabilityScope(scope, value) {
  if (value === "not_applicable") return "not_applicable";
  return (
    {
      本人: "current_user",
      课程: "confirmed_course",
      "专业/项目": "programme",
      届别: "cohort",
      部门: "department",
      全校: "all_school",
      住宿: "current_user",
    }[scope] ?? "unknown"
  );
}

function evidenceBackedTopicClaimRefs(topic, claims) {
  const evidenceIds = new Set(topic.evidence_ids ?? []);
  const matches = claims
    .filter((claim) =>
      (claim.evidence_refs ?? []).some((evidenceId) => evidenceIds.has(evidenceId)),
    )
    .map((claim) => claim.claim_id);
  const uniqueMatches = uniqueSortedStrings(matches);
  if (uniqueMatches.length === 0) {
    throw new TypeError("topic has no evidence-backed Claim");
  }
  if (uniqueMatches.length > 4) {
    throw new TypeError("topic has more Claim references than Core permits");
  }
  return uniqueMatches;
}

function findSourceDate(expected, projectedDeadline, topicLabels) {
  return (expected.dates ?? []).find((date) => {
    const decision = mapDeadlineRole(date, topicLabels);
    return (
      decision.coreRole === projectedDeadline.role &&
      date.original_text === projectedDeadline.original_text
    );
  });
}

/**
 * Build a schema-shaped reference Candidate from development expected data.
 * This is a test double for the offline evaluation path, never model input or
 * a product fallback.
 */
export function buildReferenceCoreCandidateForEvaluation(
  developmentCase,
  suppliedOracle,
) {
  const expected = assertDevelopmentCase(developmentCase);
  const oracle = suppliedOracle ?? projectCoreOverlapOracle(developmentCase);
  if (
    oracle?.oracle_version !== PHASE2_CORE_OVERLAP_ORACLE_VERSION ||
    oracle.case_id !== developmentCase.case_id ||
    oracle.split !== "development"
  ) {
    throw new TypeError("suppliedOracle does not belong to this development case");
  }

  const evidence = (expected.evidence ?? []).map((item) => ({
    evidence_id: item.evidence_id,
    quote: item.quote,
  }));
  if (evidence.length === 0) {
    throw new TypeError("reference Candidate requires body evidence");
  }

  const claimEvidenceAdditions = new Map();
  const topicLabels = oracle.topics;
  for (const deadline of oracle.deadlines) {
    const sourceDate = findSourceDate(expected, deadline, topicLabels);
    if (!sourceDate?.claim_id) {
      throw new TypeError("scored deadline must have a source claim");
    }
    const additions = claimEvidenceAdditions.get(sourceDate.claim_id) ?? [];
    additions.push(...(sourceDate.evidence_ids ?? []));
    claimEvidenceAdditions.set(sourceDate.claim_id, additions);
  }

  const claims = (expected.claims ?? []).map((claim) => {
    const evidenceRefs = uniqueSortedStrings([
      ...(claim.evidence_ids ?? []),
      ...(claimEvidenceAdditions.get(claim.claim_id) ?? []),
    ]);
    if (evidenceRefs.length === 0 || evidenceRefs.length > 4) {
      throw new TypeError("reference Claim evidence refs exceed the Core bound");
    }
    return {
      claim_id: claim.claim_id,
      type: claim.type,
      text_zh: ensureHan(claim.text, "事实：", 400),
      high_impact: Boolean(claim.high_impact),
      evidence_refs: evidenceRefs,
    };
  });
  if (claims.length === 0) {
    throw new TypeError("reference Candidate requires at least one claim");
  }

  let consequenceClaimId = expected.consequence.claim_id;
  if (!consequenceClaimId) {
    const consequenceEvidenceRefs = uniqueSortedStrings(
      expected.consequence.evidence_ids ?? [],
    );
    if (
      consequenceEvidenceRefs.length === 0 ||
      consequenceEvidenceRefs.length > 4
    ) {
      throw new TypeError(
        "synthetic consequence Claim requires bounded source evidence",
      );
    }
    consequenceClaimId = `ref-${developmentCase.case_id.toLowerCase()}-consequence`;
    claims.push({
      claim_id: consequenceClaimId,
      type: "consequence",
      text_zh: ensureHan(expected.consequence.reason, "后果：", 400),
      high_impact: expected.consequence.level === "high",
      evidence_refs: consequenceEvidenceRefs,
    });
  }

  const firstClaimId = claims[0].claim_id;
  if (claims.length > 6) {
    throw new TypeError("reference summary has more Claim refs than Core permits");
  }
  const summaryClaimIds = claims.map((claim) => claim.claim_id);
  const subject = developmentCase.input.message.subject;

  return {
    title_zh: ensureHan(subject, "通知：", 100),
    title_claim_refs: [firstClaimId],
    summary_zh: ensureHan(
      claims.map((claim) => claim.text_zh).join("；"),
      "摘要：",
      400,
    ),
    summary_claim_refs: summaryClaimIds,
    topics: (expected.topics ?? [])
      .map((topic) => ({
        label: topic.label,
        claim_refs: evidenceBackedTopicClaimRefs(topic, claims),
      }))
      .sort((left, right) => compareStrings(left.label, right.label)),
    applicability: {
      scope: mapApplicabilityScope(
        expected.applicability.scope,
        oracle.applicability.value,
      ),
      value: oracle.applicability.value,
      reason_zh: ensureHan(expected.applicability.reason, "适用性：", 300),
      claim_ref: expected.applicability.applicability_claim_id ?? null,
      profile_field_ids: [...oracle.applicability.profile_field_ids],
    },
    claims,
    evidence,
    actions: (expected.actions ?? []).map((action, index) => ({
      action_id: `ref-${developmentCase.case_id.toLowerCase()}-action-${index + 1}`,
      actor_zh: ensureHan(action.actor, "对象：", 120),
      verb_zh: ensureHan(action.verb, "执行：", 120),
      object_zh: ensureHan(action.object, "事项：", 160),
      obligation: mapActionObligation(action),
      claim_refs: (() => {
        const refs = uniqueSortedStrings(action.claim_refs ?? []);
        if (refs.length === 0 || refs.length > 4) {
          throw new TypeError("reference action Claim refs exceed the Core bound");
        }
        return refs;
      })(),
    })),
    deadlines: oracle.deadlines.map((deadline, index) => {
      const sourceDate = findSourceDate(expected, deadline, topicLabels);
      return {
        deadline_id: `ref-${developmentCase.case_id.toLowerCase()}-deadline-${index + 1}`,
        original_text: deadline.original_text,
        role: deadline.role,
        claim_ref: sourceDate.claim_id,
      };
    }),
    consequence: {
      level: oracle.consequence.level,
      reason_zh: ensureHan(expected.consequence.reason, "后果：", 300),
      claim_ref: consequenceClaimId,
    },
  };
}

export const buildReferenceCoreCandidate =
  buildReferenceCoreCandidateForEvaluation;
