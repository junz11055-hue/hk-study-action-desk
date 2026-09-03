import { validatePhase2CoreCandidate } from "../validation/phase2-core-candidate-validator.js";

export const PHASE2_CORE_SEMANTIC_EVALUATOR_VERSION =
  "phase2-core-semantic-evaluator-v1";

const REVIEW_QUEUE = Object.freeze([
  Object.freeze({
    code: "title_summary",
    path: "/title_zh",
    status: "pending",
    instruction: "人工确认标题和摘要准确、自然，并使用简体中文。",
  }),
  Object.freeze({
    code: "claim_evidence_semantics",
    path: "/claims",
    status: "pending",
    instruction: "人工确认每个 claim 的 type、high_impact 和关键语义正确，quote 真正支持 claim，且标题、摘要、topic 与 deadline 引用的是正确 claim。",
  }),
  Object.freeze({
    code: "applicability_semantics",
    path: "/applicability",
    status: "pending",
    instruction: "人工确认适用性 value、scope、reason、画像引用与 claim 的组合语义一致。",
  }),
  Object.freeze({
    code: "action_text_semantics",
    path: "/actions",
    status: "pending",
    instruction: "人工确认 action 的 actor、verb、object、obligation 与所引用 claim 正确绑定且语义等价。",
  }),
  Object.freeze({
    code: "consequence_reason_semantics",
    path: "/consequence/reason_zh",
    status: "pending",
    instruction: "人工确认后果 level、reason 与所引用 claim 正确绑定，且没有夸大或弱化。",
  }),
]);

export function createPhase2ManualReviewQueue() {
  return REVIEW_QUEUE.map((item) => ({ ...item }));
}

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

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalAtom(value) {
  if (typeof value === "string") return value;
  const keys = Object.keys(value).sort(compareStrings);
  return keys.map((key) => `${key}:${JSON.stringify(value[key])}`).join("\u0000");
}

function compareAtoms(left, right) {
  return compareStrings(canonicalAtom(left), canonicalAtom(right));
}

function uniqueSortedStrings(values) {
  return [...new Set(values)].sort(compareStrings);
}

function sortedMultiset(values) {
  return [...values].sort(compareAtoms);
}

function countAtoms(values) {
  const counts = new Map();
  const samples = new Map();
  for (const value of values) {
    const key = canonicalAtom(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!samples.has(key)) samples.set(key, value);
  }
  return { counts, samples };
}

function collectionComparison(comparison, expected, actual) {
  const expectedValues =
    comparison === "set"
      ? uniqueSortedStrings(expected)
      : sortedMultiset(expected);
  const actualValues =
    comparison === "set" ? uniqueSortedStrings(actual) : sortedMultiset(actual);
  const expectedCounts = countAtoms(expectedValues);
  const actualCounts = countAtoms(actualValues);
  const keys = uniqueSortedStrings([
    ...expectedCounts.counts.keys(),
    ...actualCounts.counts.keys(),
  ]);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  const missing = [];
  const extra = [];

  for (const key of keys) {
    const expectedCount = expectedCounts.counts.get(key) ?? 0;
    const actualCount = actualCounts.counts.get(key) ?? 0;
    tp += Math.min(expectedCount, actualCount);
    if (expectedCount > actualCount) {
      fn += expectedCount - actualCount;
      for (let index = actualCount; index < expectedCount; index += 1) {
        missing.push(expectedCounts.samples.get(key));
      }
    }
    if (actualCount > expectedCount) {
      fp += actualCount - expectedCount;
      for (let index = expectedCount; index < actualCount; index += 1) {
        extra.push(actualCounts.samples.get(key));
      }
    }
  }

  return {
    public: {
      comparison,
      exact: fp === 0 && fn === 0,
      tp,
      fp,
      fn,
      expected: expectedValues,
      actual: actualValues,
    },
    missing: sortedMultiset(missing),
    extra: sortedMultiset(extra),
  };
}

function scalarComparison(expected, actual) {
  const exact = expected === actual;
  return {
    comparison: "scalar",
    exact,
    tp: exact ? 1 : 0,
    fp: exact ? 0 : 1,
    fn: exact ? 0 : 1,
    expected,
    actual,
  };
}

function error(code, severity, path, expected, actual) {
  return { code, severity, path, expected, actual };
}

function assertInputs(oracle, candidate) {
  if (
    !isPlainObject(oracle) ||
    oracle.oracle_version !== "phase2-core-overlap-oracle-v1" ||
    oracle.split !== "development" ||
    typeof oracle.case_id !== "string" ||
    !Array.isArray(oracle.topics) ||
    !isPlainObject(oracle.applicability) ||
    typeof oracle.applicability.high_impact !== "boolean" ||
    !Array.isArray(oracle.actions) ||
    oracle.actions.some((action) => typeof action.high_impact !== "boolean") ||
    !Array.isArray(oracle.deadlines) ||
    oracle.deadlines.some(
      (deadline) => typeof deadline.high_impact !== "boolean",
    ) ||
    !isPlainObject(oracle.consequence) ||
    typeof oracle.consequence.high_impact !== "boolean" ||
    !Array.isArray(oracle.excluded_fields)
  ) {
    throw new TypeError("oracle does not match the Phase 2 Core-overlap contract");
  }
  if (
    !isPlainObject(candidate) ||
    !Array.isArray(candidate.topics) ||
    !isPlainObject(candidate.applicability) ||
    !Array.isArray(candidate.actions) ||
    !Array.isArray(candidate.deadlines) ||
    !isPlainObject(candidate.consequence)
  ) {
    throw new TypeError("candidate must first pass the Core Candidate gate");
  }
}

function candidateClaimIsHighImpact(candidate, claimId) {
  return (
    typeof claimId === "string" &&
    candidate.claims.some(
      (claim) => claim.claim_id === claimId && claim.high_impact === true,
    )
  );
}

function consumeActionDescriptor(actions, obligation) {
  let index = actions.findIndex(
    (action) => action.obligation === obligation && action.highImpact === true,
  );
  if (index < 0) {
    index = actions.findIndex((action) => action.obligation === obligation);
  }
  if (index < 0) return { obligation, highImpact: false };
  const [action] = actions.splice(index, 1);
  return action;
}

function actionErrors(comparison, oracle, candidate) {
  const errors = [];
  const expectedPool = oracle.actions.map((action) => ({
    obligation: action.obligation,
    highImpact: action.high_impact,
  }));
  const actualPool = candidate.actions.map((action) => ({
    obligation: action.obligation,
    highImpact: action.claim_refs.some((claimId) =>
      candidateClaimIsHighImpact(candidate, claimId),
    ),
  }));
  const missing = comparison.missing.map((obligation) =>
    consumeActionDescriptor(expectedPool, obligation),
  );
  const extra = comparison.extra.map((obligation) =>
    consumeActionDescriptor(actualPool, obligation),
  );
  const pairCount = Math.min(missing.length, extra.length);

  function severity(expected, actual) {
    return expected?.obligation === "mandatory" ||
      actual?.obligation === "mandatory" ||
      expected?.highImpact === true ||
      actual?.highImpact === true
      ? "P0"
      : "P1";
  }

  for (let index = 0; index < pairCount; index += 1) {
    errors.push(
      error(
        "action_obligation_mismatch",
        severity(missing[index], extra[index]),
        "/actions/*/obligation",
        missing[index].obligation,
        extra[index].obligation,
      ),
    );
  }
  for (const expected of missing.slice(pairCount)) {
    errors.push(
      error(
        "action_missing",
        severity(expected, null),
        "/actions",
        expected.obligation,
        null,
      ),
    );
  }
  for (const actual of extra.slice(pairCount)) {
    errors.push(
      error(
        "action_unexpected",
        severity(null, actual),
        "/actions",
        null,
        actual.obligation,
      ),
    );
  }
  return errors;
}

function removeAt(values, index) {
  return [...values.slice(0, index), ...values.slice(index + 1)];
}

function pairDeadlineMismatches(
  missingInput,
  extraInput,
  oracle,
  candidate,
) {
  let missing = [...missingInput];
  let extra = [...extraInput];
  const errors = [];

  function severity(expected, actual) {
    const expectedHighImpact =
      expected !== null &&
      oracle.deadlines.some(
        (deadline) =>
          deadline.original_text === expected.original_text &&
          deadline.role === expected.role &&
          deadline.high_impact === true,
      );
    const actualHighImpact =
      actual !== null &&
      candidate.deadlines.some(
        (deadline) =>
          deadline.original_text === actual.original_text &&
          deadline.role === actual.role &&
          candidateClaimIsHighImpact(candidate, deadline.claim_ref),
      );
    return expectedHighImpact || actualHighImpact ? "P0" : "P1";
  }

  function pairBy(predicate, code, path, selectExpected, selectActual) {
    for (let expectedIndex = 0; expectedIndex < missing.length; ) {
      const actualIndex = extra.findIndex((actual) =>
        predicate(missing[expectedIndex], actual),
      );
      if (actualIndex < 0) {
        expectedIndex += 1;
        continue;
      }
      const expected = missing[expectedIndex];
      const actual = extra[actualIndex];
      errors.push(
        error(
          code,
          severity(expected, actual),
          path,
          selectExpected(expected),
          selectActual(actual),
        ),
      );
      missing = removeAt(missing, expectedIndex);
      extra = removeAt(extra, actualIndex);
    }
  }

  pairBy(
    (expected, actual) => expected.role === actual.role,
    "deadline_original_text_mismatch",
    "/deadlines/*/original_text",
    (value) => value.original_text,
    (value) => value.original_text,
  );
  pairBy(
    (expected, actual) => expected.original_text === actual.original_text,
    "deadline_role_mismatch",
    "/deadlines/*/role",
    (value) => value.role,
    (value) => value.role,
  );

  const genericPairCount = Math.min(missing.length, extra.length);
  for (let index = 0; index < genericPairCount; index += 1) {
    errors.push(
      error(
        "deadline_atom_mismatch",
        severity(missing[index], extra[index]),
        "/deadlines",
        missing[index],
        extra[index],
      ),
    );
  }
  for (const expected of missing.slice(genericPairCount)) {
    errors.push(
      error(
        "deadline_missing",
        severity(expected, null),
        "/deadlines",
        expected,
        null,
      ),
    );
  }
  for (const actual of extra.slice(genericPairCount)) {
    errors.push(
      error(
        "deadline_unexpected",
        severity(null, actual),
        "/deadlines",
        null,
        actual,
      ),
    );
  }
  return errors;
}

/**
 * Compare one captured Core Candidate with a frozen development-only Oracle.
 * Candidate IDs, reference IDs, and array order are deliberately ignored.
 * The Candidate is first validated against its exact Model Input; neither input
 * is mutated, and the semantic result is returned as a separate frozen value.
 */
export function evaluateCoreCandidateSemantics({
  oracle,
  candidate,
  modelInput,
}) {
  assertInputs(oracle, candidate);
  validatePhase2CoreCandidate(candidate, modelInput);

  const topics = collectionComparison(
    "set",
    oracle.topics,
    candidate.topics.map((topic) => topic.label),
  );
  const applicabilityValue = scalarComparison(
    oracle.applicability.value,
    candidate.applicability.value,
  );
  const profileFieldIds = collectionComparison(
    "set",
    oracle.applicability.profile_field_ids,
    candidate.applicability.profile_field_ids,
  );
  const actions = collectionComparison(
    "multiset",
    oracle.actions.map((action) => action.obligation),
    candidate.actions.map((action) => action.obligation),
  );
  const deadlines = collectionComparison(
    "multiset",
    oracle.deadlines.map((deadline) => ({
      original_text: deadline.original_text,
      role: deadline.role,
    })),
    candidate.deadlines.map((deadline) => ({
      original_text: deadline.original_text,
      role: deadline.role,
    })),
  );
  const consequenceLevel = scalarComparison(
    oracle.consequence.level,
    candidate.consequence.level,
  );
  const applicabilitySeverity =
    oracle.applicability.high_impact === true ||
    candidateClaimIsHighImpact(candidate, candidate.applicability.claim_ref)
      ? "P0"
      : "P1";
  const consequenceSeverity =
    oracle.consequence.high_impact === true ||
    oracle.consequence.level === "high" ||
    candidate.consequence.level === "high" ||
    candidateClaimIsHighImpact(candidate, candidate.consequence.claim_ref)
      ? "P0"
      : "P1";

  const dimensions = {
    topics: topics.public,
    applicability_value: applicabilityValue,
    profile_field_ids: profileFieldIds.public,
    actions: actions.public,
    deadlines: deadlines.public,
    consequence_level: consequenceLevel,
  };

  const errors = [];
  for (const label of topics.missing) {
    errors.push(error("topic_missing", "P1", "/topics", label, null));
  }
  for (const label of topics.extra) {
    errors.push(error("topic_unexpected", "P1", "/topics", null, label));
  }
  if (!applicabilityValue.exact) {
    errors.push(
      error(
        "applicability_value_mismatch",
        applicabilitySeverity,
        "/applicability/value",
        applicabilityValue.expected,
        applicabilityValue.actual,
      ),
    );
  }
  for (const profileId of profileFieldIds.missing) {
    errors.push(
      error(
        "profile_field_id_missing",
        applicabilitySeverity,
        "/applicability/profile_field_ids",
        profileId,
        null,
      ),
    );
  }
  for (const profileId of profileFieldIds.extra) {
    errors.push(
      error(
        "profile_field_id_unexpected",
        applicabilitySeverity,
        "/applicability/profile_field_ids",
        null,
        profileId,
      ),
    );
  }
  errors.push(...actionErrors(actions, oracle, candidate));
  errors.push(
    ...pairDeadlineMismatches(
      deadlines.missing,
      deadlines.extra,
      oracle,
      candidate,
    ),
  );
  if (!consequenceLevel.exact) {
    errors.push(
      error(
        "consequence_level_mismatch",
        consequenceSeverity,
        "/consequence/level",
        consequenceLevel.expected,
        consequenceLevel.actual,
      ),
    );
  }

  const dimensionValues = Object.values(dimensions);
  const totals = {
    dimensions_total: dimensionValues.length,
    dimensions_exact: dimensionValues.filter((dimension) => dimension.exact)
      .length,
    tp: dimensionValues.reduce((sum, dimension) => sum + dimension.tp, 0),
    fp: dimensionValues.reduce((sum, dimension) => sum + dimension.fp, 0),
    fn: dimensionValues.reduce((sum, dimension) => sum + dimension.fn, 0),
  };

  return deepFreeze({
    evaluator_version: PHASE2_CORE_SEMANTIC_EVALUATOR_VERSION,
    case_id: oracle.case_id,
    automatic: {
      passed: dimensionValues.every((dimension) => dimension.exact),
      dimensions,
      totals,
    },
    errors,
    review_queue: createPhase2ManualReviewQueue(),
    excluded_fields: oracle.excluded_fields.map((item) => ({ ...item })),
  });
}
