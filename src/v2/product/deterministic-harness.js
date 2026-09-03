import { hashCanonicalJson } from "../validation/canonical-json.js";
import {
  freezeJson,
  validateActionCardV02,
} from "./action-card-v02.js";
import {
  PHASE2AO_ACTION_CARD_VERSION,
  PHASE2AO_HARNESS_POLICY_VERSION,
  isRfc3339,
} from "./contracts.js";

const TOPIC_MAP = Object.freeze({
  "专业与课程": "academic_course",
  "缴费与资助": "payment_funding",
  "注册与学籍": "registration_status",
  "签证与身份": "visa_identity",
  "考试与成绩": "exam_results",
  "账号安全": "account_security",
  "校园活动": "campus_activity",
  "住宿与校园生活": "housing_campus_life",
  "其他校务资讯": "other_school_affairs",
});
const SCOPE_MAP = Object.freeze({
  current_user: "self",
  confirmed_course: "confirmed_course",
  programme: "program",
  cohort: "cohort",
  department: "faculty",
  all_school: "schoolwide",
  unknown: "undetermined",
  not_applicable: "not_applicable",
});
const MONTHS = Object.freeze({
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
});
const ROLE_ORDER = Object.freeze([
  "action",
  "date",
  "consequence",
  "applicability",
  "summary",
]);

export class Phase2aoHarnessError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2aoHarnessError";
    this.code = code;
  }
}
function fail(message, cause) {
  throw new Phase2aoHarnessError("harness_projection_failed", message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function unique(values) {
  return [...new Set(values)];
}

function boundedId(base, role) {
  const value = `${base}.${role}`;
  if (value.length <= 64) return value;
  const suffix = hashCanonicalJson({ base, role }).slice(7, 19);
  return `${base.slice(0, 50)}.${suffix}`;
}

function normalizeDeadline(originalText) {
  const match = /^(\d{1,2}):(\d{2})\s+(am|pm)\s+HKT\s+on\s+(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})$/u.exec(
    originalText,
  );
  if (!match) fail("The DEV001 deadline could not be normalized safely.");
  const [, hourText, minuteText, meridiem, dayText, monthName, yearText] =
    match;
  const month = MONTHS[monthName];
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const day = Number(dayText);
  const year = Number(yearText);
  if (
    month === undefined ||
    hour < 1 ||
    hour > 12 ||
    minute > 59 ||
    day < 1 ||
    day > 31
  ) {
    fail("The DEV001 deadline fields are invalid.");
  }
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    fail("The DEV001 deadline date is not real.");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
}

function capabilityAllowed(extra = {}) {
  return {
    state: "allowed",
    decisionSource: "harness_policy",
    reasonCodes: [],
    message: null,
    ...extra,
  };
}

function capabilityUnavailable(
  state,
  decisionSource,
  reasonCodes,
  message,
  extra = {},
) {
  return {
    state,
    decisionSource,
    reasonCodes,
    message,
    ...extra,
  };
}

function nativeImportanceSignals(input) {
  const facts = [
    ["sender_importance", input.nativeImportance.senderImportance],
    ["provider_importance", input.nativeImportance.providerImportance],
    ["user_star", input.nativeImportance.userStar],
  ];
  return facts.map(([kind, fact]) => {
    if (fact.present !== true) {
      return { kind, state: "unknown", protection: "unknown" };
    }
    if (fact.value === true) {
      return { kind, state: "present", protection: "active" };
    }
    return { kind, state: "absent", protection: "not_applicable" };
  });
}

function profileEvidenceById(input) {
  return new Map(
    input.trustedProfileEvidence.map((item) => [item.profile_field_id, item]),
  );
}

function applicabilityState(value) {
  if (value === "applies") return "confirmed";
  if (value === "possibly_applies") return "possible";
  if (value === "not_applicable") return "not_applicable";
  return "unconfirmed";
}

function projectClaimGraph(candidate) {
  const candidateClaims = new Map(
    candidate.claims.map((claim) => [claim.claim_id, claim]),
  );
  const roles = new Map(candidate.claims.map((claim) => [claim.claim_id, new Set()]));
  const addRole = (claimId, role) => {
    const claimRoles = roles.get(claimId);
    if (claimRoles === undefined) fail("Candidate graph references an unknown Claim.");
    claimRoles.add(role);
  };

  if (candidate.applicability.claim_ref !== null) {
    addRole(candidate.applicability.claim_ref, "applicability");
  }
  const deadlineClaimIds = new Set(
    candidate.deadlines.map((deadline) => deadline.claim_ref),
  );
  for (const deadline of candidate.deadlines) addRole(deadline.claim_ref, "date");
  if (candidate.consequence.claim_ref !== null) {
    addRole(candidate.consequence.claim_ref, "consequence");
  }
  const actionRoleRefs = new Map();
  for (const action of candidate.actions) {
    let refs = action.claim_refs.filter((claimId) => !deadlineClaimIds.has(claimId));
    if (refs.length === 0) refs = [...action.claim_refs];
    actionRoleRefs.set(action.action_id, refs);
    for (const claimId of refs) addRole(claimId, "action");
  }
  for (const claimId of [
    ...candidate.title_claim_refs,
    ...candidate.summary_claim_refs,
  ]) {
    if (roles.get(claimId)?.size === 0) addRole(claimId, "summary");
  }

  const projectedId = new Map();
  const claims = [];
  for (const claim of candidate.claims) {
    for (const role of ROLE_ORDER) {
      if (!roles.get(claim.claim_id).has(role)) continue;
      const id = boundedId(claim.claim_id, role);
      projectedId.set(`${claim.claim_id}:${role}`, id);
      claims.push({
        id,
        kind: role,
        text: claim.text_zh,
        highImpact: claim.high_impact,
        factState: "confirmed",
        evidenceIds: [...claim.evidence_refs],
      });
    }
  }
  const forRole = (claimId, role) => {
    const id = projectedId.get(`${claimId}:${role}`);
    if (id === undefined) fail("Harness Claim projection is incomplete.");
    return id;
  };
  const preferred = (claimId) => {
    for (const role of ROLE_ORDER) {
      const id = projectedId.get(`${claimId}:${role}`);
      if (id !== undefined) return id;
    }
    fail("Harness could not project a user-visible Claim reference.");
  };
  return { candidateClaims, claims, forRole, preferred, actionRoleRefs };
}

function sourceTrust(input) {
  const official =
    input.securityFacts.connectorAuthentication === "passed" &&
    input.securityFacts.senderMapping === "matched" &&
    input.securityFacts.securityConflict === false;
  const channelVerified =
    official && input.securityFacts.actionChannel.status === "verified";
  return {
    official,
    channelVerified,
    value: {
      sourceStatus: official ? "official_verified" : "unverified",
      actionChannelStatus: channelVerified ? "verified" : "unverified",
      reason: official
        ? "合成连接认证、发件映射与行动渠道安全事实均已通过确定性校验。"
        : "合成来源或行动渠道尚未通过全部确定性安全事实校验。",
    },
  };
}

function dueState(dates, currentTime) {
  const earliest = Math.min(
    ...dates.map((date) => Date.parse(date.normalized.value)),
  );
  const difference = earliest - Date.parse(currentTime);
  if (difference < 0) return "overdue";
  if (difference <= 48 * 60 * 60_000) return "due_soon";
  return "upcoming";
}

function provenance(executionMode, analyzedAt) {
  const disclosure = {
    synthetic_mock: "完全合成 Mock 候选经确定性 Harness 技术校验；未调用模型。",
    captured_replay: "已审阅的合成 DeepSeek 结果回放经 Harness 技术校验；不是本次实时调用。",
    live_model: "本次 DeepSeek 生成结果已通过 Harness 技术校验。",
  }[executionMode];
  if (disclosure === undefined || !isRfc3339(analyzedAt)) {
    fail("Harness provenance is invalid.");
  }
  return {
    sourceMode: executionMode,
    harnessVerified: true,
    analyzedAt,
    disclosure,
  };
}

export function buildPhase2aoActionCard({
  productInput,
  candidate,
  validationEvidence,
  executionMode,
  analyzedAt,
} = {}) {
  try {
    if (
      productInput?.caseId !== "DEV001" ||
      !["synthetic_mock", "captured_replay", "live_model"].includes(
        executionMode,
      ) ||
      !Array.isArray(validationEvidence?.body_evidence_locations)
    ) {
      fail("Harness inputs are invalid.");
    }
    const graph = projectClaimGraph(candidate);
    const profileById = profileEvidenceById(productInput);
    const currentDate = productInput.harnessContext.currentTimeHkt.slice(0, 10);
    const applicabilityClaimRef = candidate.applicability.claim_ref;
    if (applicabilityClaimRef === null) {
      fail("DEV001 requires an evidence-backed applicability Claim.");
    }
    const relevanceBasis = candidate.applicability.profile_field_ids.map(
      (profileId) => {
        const evidence = profileById.get(profileId);
        const currentConfirmed =
          evidence?.confirmation_status === "confirmed" &&
          evidence.valid_until >= currentDate &&
          (evidence.field_type !== "course" ||
            evidence.course_status === "confirmed");
        return {
          id: boundedId(`basis-${profileId}`, "profile"),
          kind: "profile_field",
          label: `合成画像：${evidence?.value ?? profileId}`,
          profileState: currentConfirmed ? "confirmed" : "expired",
          claimRefs: [graph.forRole(applicabilityClaimRef, "applicability")],
        };
      },
    );
    if (relevanceBasis.length === 0) fail("DEV001 relevance lacks profile evidence.");

    const actions = candidate.actions.map((action) => ({
      id: action.action_id,
      origin: "mail",
      actor: action.actor_zh,
      action: action.verb_zh,
      object: action.object_zh,
      displayText: `${action.actor_zh}需${action.verb_zh}${action.object_zh}。`,
      obligation: action.obligation,
      factState: "confirmed",
      condition: null,
      claimRefs: graph.actionRoleRefs
        .get(action.action_id)
        .map((claimId) => graph.forRole(claimId, "action")),
    }));
    const trust = sourceTrust(productInput);
    const relevanceConfirmed =
      candidate.applicability.value === "applies" &&
      relevanceBasis.every((basis) => basis.profileState === "confirmed");
    const requiredAction = actions.some(
      (action) => action.obligation === "mandatory",
    );
    const actionGate =
      requiredAction &&
      relevanceConfirmed &&
      trust.official &&
      trust.channelVerified;

    const dates = candidate.deadlines.map((deadline) => {
      const linkedActionIds = candidate.actions
        .filter((action) => action.claim_refs.includes(deadline.claim_ref))
        .map((action) => action.action_id);
      const normalized = normalizeDeadline(deadline.original_text);
      const eligible = actionGate && linkedActionIds.length > 0;
      return {
        id: deadline.deadline_id,
        role: deadline.role,
        originalText: deadline.original_text,
        factState: "confirmed",
        normalized: {
          kind: "date_time",
          value: normalized,
          timeZone: "Asia/Hong_Kong",
        },
        linkedActionIds,
        claimRefs: [graph.forRole(deadline.claim_ref, "date")],
        calendarEligibility: {
          eligible,
          blockedReasonCode: eligible ? null : "safety_gate_not_passed",
        },
      };
    });
    if (dates.length === 0) fail("DEV001 must expose one confirmed deadline.");
    const eligibleDateIds = dates
      .filter((date) => date.calendarEligibility.eligible)
      .map((date) => date.id);

    const titleClaimRefs = candidate.title_claim_refs.map(graph.preferred);
    const summaryClaimRefs = candidate.summary_claim_refs.map(graph.preferred);
    const actionClaimRefs = unique(
      actions.flatMap((action) => action.claimRefs),
    );
    const homeSectionClaimRefs = unique([
      ...actionClaimRefs,
      graph.forRole(applicabilityClaimRef, "applicability"),
      ...dates.flatMap((date) => date.claimRefs),
    ]);
    const topics = unique(
      candidate.topics.map((topic) => {
        const projected = TOPIC_MAP[topic.label];
        if (projected === undefined) fail("Candidate topic cannot be projected.");
        return projected;
      }),
    );
    const consequenceClaimRefs =
      candidate.consequence.claim_ref === null
        ? []
        : [graph.forRole(candidate.consequence.claim_ref, "consequence")];
    if (consequenceClaimRefs.length === 0) {
      fail("DEV001 consequence must be evidence-backed.");
    }

    const card = {
      contractVersion: PHASE2AO_ACTION_CARD_VERSION,
      synthetic: true,
      notification: {
        id: productInput.notification.id,
        schoolName: productInput.notification.schoolName,
        senderName: productInput.notification.senderName,
        senderAddress: productInput.notification.senderAddress,
        subject: productInput.notification.subject,
        sentAt: productInput.notification.sentAt,
        receivedAt: productInput.notification.receivedAt,
        language:
          productInput.notification.language === "zh-Hant"
            ? "zh_hant"
            : productInput.notification.language === "zh-Hans"
              ? "zh_hans"
              : productInput.notification.language,
      },
      provenance: provenance(executionMode, analyzedAt),
      homeSection: actionGate ? "action_required" : "priority_reading",
      homeSectionExplanation: actionGate
        ? "该合成邮件包含已确认课程的强制行动，且来源、行动渠道、证据与截止日期均已通过确定性技术门。"
        : "该通知与已确认课程相关，但尚未通过全部行动安全门，因此只能优先阅读。",
      homeSectionClaimRefs,
      nativeImportanceSignals: nativeImportanceSignals(productInput),
      title: candidate.title_zh,
      titleClaimRefs,
      summary: candidate.summary_zh,
      summaryClaimRefs,
      topics,
      relevance: {
        scope: SCOPE_MAP[candidate.applicability.scope],
        factState: relevanceConfirmed
          ? "confirmed"
          : applicabilityState(candidate.applicability.value),
        explanation: candidate.applicability.reason_zh,
        basis: relevanceBasis,
      },
      sourceTrust: trust.value,
      informationCompleteness: { status: "complete", gaps: [] },
      consequence: {
        level: candidate.consequence.level,
        factState: "confirmed",
        reason: candidate.consequence.reason_zh,
        highConsequenceClue: false,
        claimRefs: consequenceClaimRefs,
      },
      mailActions: actions,
      managementSuggestions: [
        {
          id: "suggestion-calendar-preview",
          origin: "ai_management_suggestion",
          safetyClass: "low_risk_personal_management",
          text: "可以先在产品内预览这个截止日期。",
          reason: "截止日期和关联强制行动已通过确定性技术门。",
          claimRefs: [...dates[0].claimRefs],
        },
      ],
      dates,
      claims: graph.claims,
      evidence: candidate.evidence.map((item) => ({
        id: item.evidence_id,
        quote: item.quote,
        location: { kind: "body" },
      })),
      risks: [],
      unknowns: [],
      relation: {
        disposition: "new_item",
        matchState: "not_applicable",
        relatedItemId: null,
        explanation: "合成历史事项为空，因此创建独立新事项，不继承任何旧状态。",
      },
      states: {
        read: "unread",
        management: "active",
        item: "active",
        visibility: "active",
        due: dueState(dates, productInput.harnessContext.currentTimeHkt),
        version: "current",
        updateKind: "none",
        previousVersionId: null,
        supersededByVersionId: null,
        mergedIntoId: null,
      },
      capabilityBinding: {
        viewModelVersion: PHASE2AO_ACTION_CARD_VERSION,
        harnessPolicyVersion: PHASE2AO_HARNESS_POLICY_VERSION,
        itemVersion: "dev001-item-v1",
      },
      capabilities: {
        viewOriginal: capabilityUnavailable(
          "unavailable",
          "phase_boundary",
          ["not_implemented"],
          "当前合成联调阶段不向浏览器返回完整邮件正文。",
        ),
        viewEvidence: capabilityAllowed(),
        askFixedFollowups: capabilityUnavailable(
          "unavailable",
          "phase_boundary",
          ["not_implemented"],
          "当前阶段尚未实现固定追问。",
        ),
        retryAnalysis: capabilityAllowed(),
        openTrustedActionChannel: actionGate
          ? capabilityAllowed()
          : capabilityUnavailable(
              "blocked",
              "harness_policy",
              ["source_unverified"],
              "来源或行动渠道未通过安全门。",
            ),
        previewCalendar:
          eligibleDateIds.length > 0
            ? capabilityAllowed({ eligibleDateIds })
            : capabilityUnavailable(
                "blocked",
                "harness_policy",
                ["date_unconfirmed"],
                "日期或关联行动未通过技术门。",
                { eligibleDateIds: [] },
              ),
        writeCalendar: capabilityUnavailable(
          "blocked",
          "phase_boundary",
          ["not_connected"],
          "当前阶段未连接真实日历，禁止写入。",
        ),
        markRead: capabilityUnavailable(
          "unavailable",
          "phase_boundary",
          ["not_implemented"],
          "当前阶段只验证读取与展示。",
        ),
        snooze: capabilityUnavailable(
          "unavailable",
          "phase_boundary",
          ["not_implemented"],
          "当前阶段尚未实现稍后处理。",
        ),
        markArranged: capabilityUnavailable(
          "unavailable",
          "phase_boundary",
          ["not_implemented"],
          "当前阶段尚未实现已安排状态。",
        ),
        markCompleted: capabilityUnavailable(
          "unavailable",
          "phase_boundary",
          ["not_implemented"],
          "当前阶段尚未实现完成状态。",
        ),
        markIrrelevant: capabilityUnavailable(
          "unavailable",
          "phase_boundary",
          ["not_implemented"],
          "当前阶段尚未实现无关标记。",
        ),
        correctClassification: capabilityUnavailable(
          "unavailable",
          "phase_boundary",
          ["not_implemented"],
          "当前阶段尚未实现分类纠正。",
        ),
      },
    };
    validateActionCardV02(card);
    return freezeJson(card);
  } catch (error) {
    if (error instanceof Phase2aoHarnessError) throw error;
    throw new Phase2aoHarnessError(
      "harness_projection_failed",
      "The Candidate could not be safely projected to Action Card v0.2.",
      { cause: error },
    );
  }
}
