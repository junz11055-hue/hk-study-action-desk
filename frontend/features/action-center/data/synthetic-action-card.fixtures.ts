import type { ActionCardViewModelInput } from "../model/action-card-view-model";
import { syntheticActionCardFixture } from "./synthetic-action-card.fixture";

function cloneBaseFixture(): ActionCardViewModelInput {
  return structuredClone(syntheticActionCardFixture);
}

function createPaymentDeadlineFixture(): ActionCardViewModelInput {
  const fixture = cloneBaseFixture();

  fixture.notification = {
    id: "synthetic-notification-payment-001",
    schoolName: "维港都会大学（合成）",
    senderName: "合成财务处",
    senderAddress: "finance-office@harbour-metropolitan.invalid",
    subject: "Tuition payment deadline — 4 September 2026",
    sentAt: "2026-08-31T08:45:00+08:00",
    receivedAt: "2026-08-31T08:45:03+08:00",
    language: "en",
  };
  fixture.provenance.disclosure =
    "这是完全合成的缴费案例，未调用模型、未连接邮箱，也不会写入真实日历。";
  fixture.homeSection = "action_required";
  fixture.homeSectionExplanation =
    "合成邮件明确要求当前学生缴纳学费，来源与办理渠道在夹具中均已验证，并写明截止日期和逾期后果。";
  fixture.homeSectionClaimRefs = [
    "claim-payment-applicability-001",
    "claim-payment-action-001",
    "claim-payment-date-001",
    "claim-payment-consequence-001",
  ];
  fixture.nativeImportanceSignals = [
    {
      kind: "sender_importance",
      state: "absent",
      protection: "not_applicable",
    },
    {
      kind: "provider_importance",
      state: "present",
      protection: "active",
    },
    {
      kind: "user_star",
      state: "absent",
      protection: "not_applicable",
    },
  ];
  fixture.title = "9 月 4 日前缴纳第一学期学费";
  fixture.titleClaimRefs = [
    "claim-payment-action-001",
    "claim-payment-date-001",
  ];
  fixture.summary =
    "合成财务处要求在 9 月 4 日 17:00（香港时间）前缴纳第一学期学费 HK$42,100；逾期可能影响注册确认。";
  fixture.summaryClaimRefs = [
    "claim-payment-action-001",
    "claim-payment-date-001",
    "claim-payment-consequence-001",
  ];
  fixture.topics = ["payment_funding", "registration_status"];
  fixture.relevance = {
    scope: "self",
    factState: "confirmed",
    explanation: "邮件正文明确写明该合成通知对应当前学生的第一学期账单。",
    basis: [
      {
        id: "basis-payment-audience-001",
        kind: "mail_audience",
        label: "合成邮件明确指向当前学生账单",
        claimRefs: ["claim-payment-applicability-001"],
      },
    ],
  };
  fixture.sourceTrust = {
    sourceStatus: "official_verified",
    actionChannelStatus: "verified",
    reason: "此合成案例把财务处身份与学校缴费入口设为已验证，用于测试安全门通过后的展示。",
  };
  fixture.informationCompleteness = { status: "complete", gaps: [] };
  fixture.consequence = {
    level: "high",
    factState: "confirmed",
    reason: "合成邮件明确写明逾期可能影响注册确认。",
    highConsequenceClue: true,
    claimRefs: ["claim-payment-consequence-001"],
  };
  fixture.mailActions = [
    {
      id: "action-pay-tuition-001",
      origin: "mail",
      actor: "学生",
      action: "缴纳",
      object: "第一学期学费",
      displayText: "通过已验证的学校缴费入口缴纳 HK$42,100。",
      obligation: "mandatory",
      factState: "confirmed",
      condition: null,
      claimRefs: ["claim-payment-action-001"],
    },
  ];
  fixture.managementSuggestions = [
    {
      id: "suggestion-preview-payment-date-001",
      origin: "ai_management_suggestion",
      safetyClass: "low_risk_personal_management",
      text: "可以先预览一条本地日历事件，确认时间无误后再决定是否记录。",
      reason: "这是合成环境中的个人管理建议，不代表已经缴费或已经写入日历。",
      claimRefs: ["claim-payment-action-001", "claim-payment-date-001"],
    },
  ];
  fixture.dates = [
    {
      id: "date-payment-deadline-001",
      role: "payment_deadline",
      originalText: "4 September 2026 at 5:00 pm Hong Kong time",
      factState: "confirmed",
      normalized: {
        kind: "date_time",
        value: "2026-09-04T17:00:00+08:00",
        timeZone: "Asia/Hong_Kong",
      },
      linkedActionIds: ["action-pay-tuition-001"],
      claimRefs: ["claim-payment-date-001"],
      calendarEligibility: {
        eligible: true,
        blockedReasonCode: null,
      },
    },
  ];
  fixture.claims = [
    {
      id: "claim-payment-applicability-001",
      kind: "applicability",
      text: "该合成账单通知适用于当前学生。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-payment-audience-001"],
    },
    {
      id: "claim-payment-action-001",
      kind: "action",
      text: "学生必须缴纳第一学期学费 HK$42,100。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-payment-action-001"],
    },
    {
      id: "claim-payment-date-001",
      kind: "date",
      text: "缴费截止时间为 2026 年 9 月 4 日 17:00（香港时间）。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-payment-action-001"],
    },
    {
      id: "claim-payment-consequence-001",
      kind: "consequence",
      text: "逾期可能影响注册确认。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-payment-consequence-001"],
    },
  ];
  fixture.evidence = [
    {
      id: "evidence-payment-audience-001",
      quote: "This tuition notice applies to your first-semester student account.",
      location: { kind: "body", paragraph: 1 },
    },
    {
      id: "evidence-payment-action-001",
      quote:
        "You must pay HK$42,100 by 5:00 pm Hong Kong time on 4 September 2026 through the verified student payment portal.",
      location: { kind: "body", paragraph: 2 },
    },
    {
      id: "evidence-payment-consequence-001",
      quote: "Late payment may delay confirmation of your registration.",
      location: { kind: "body", paragraph: 3 },
    },
  ];
  fixture.risks = [];
  fixture.unknowns = [];
  fixture.relation = {
    disposition: "new_item",
    matchState: "not_applicable",
    relatedItemId: null,
    explanation: "这是独立的合成缴费事项，没有继承旧通知状态。",
  };
  fixture.states = {
    read: "unread",
    management: "active",
    item: "active",
    visibility: "active",
    due: "due_soon",
    version: "current",
    updateKind: "none",
    previousVersionId: null,
    supersededByVersionId: null,
    mergedIntoId: null,
  };
  fixture.capabilityBinding.itemVersion = "synthetic-payment-item-v1";
  fixture.capabilities.openTrustedActionChannel = {
    state: "unavailable",
    decisionSource: "phase_boundary",
    reasonCodes: ["not_implemented"],
    message: "Phase 1B 只展示安全裁决，不打开任何真实缴费入口。",
  };
  fixture.capabilities.previewCalendar = {
    state: "allowed",
    decisionSource: "synthetic_fixture",
    reasonCodes: [],
    message: null,
    eligibleDateIds: ["date-payment-deadline-001"],
  };

  return fixture;
}

function createSecurityRiskFixture(): ActionCardViewModelInput {
  const fixture = cloneBaseFixture();

  fixture.notification = {
    id: "synthetic-notification-security-001",
    schoolName: "维港都会大学（合成）",
    senderName: "合成账号服务中心",
    senderAddress: "account-alert@harbour-metropolitan.invalid",
    subject: "Important! Verify your account immediately",
    sentAt: "2026-09-01T07:20:00+08:00",
    receivedAt: "2026-09-01T07:20:02+08:00",
    language: "en",
  };
  fixture.provenance.disclosure =
    "这是完全合成的账号安全案例，未调用模型、未连接邮箱，也不包含真实链接或账号。";
  fixture.homeSection = "priority_reading";
  fixture.homeSectionExplanation =
    "发件人把邮件标为重要，但来源和行动渠道均可疑；系统只突出安全风险，不把邮件中的操作包装成官方要求。";
  fixture.homeSectionClaimRefs = [
    "claim-security-applicability-001",
    "claim-security-action-001",
    "claim-security-risk-001",
  ];
  fixture.nativeImportanceSignals = [
    {
      kind: "sender_importance",
      state: "present",
      protection: "active",
    },
    {
      kind: "provider_importance",
      state: "absent",
      protection: "not_applicable",
    },
    {
      kind: "user_star",
      state: "absent",
      protection: "not_applicable",
    },
  ];
  fixture.title = "重要标记邮件要求验证账号，但来源可疑";
  fixture.titleClaimRefs = ["claim-security-risk-001"];
  fixture.summary =
    "邮件要求立即通过内嵌页面输入账号和验证码；当前无法验证发件身份与链接，先不要点击或提交凭证。";
  fixture.summaryClaimRefs = [
    "claim-security-action-001",
    "claim-security-risk-001",
  ];
  fixture.topics = ["account_security"];
  fixture.relevance = {
    scope: "self",
    factState: "confirmed",
    explanation: "邮件正文声称当前收件人的学校账号需要验证，但该声称不等于来源可信。",
    basis: [
      {
        id: "basis-security-audience-001",
        kind: "mail_audience",
        label: "合成邮件明确称呼当前账号持有人",
        claimRefs: ["claim-security-applicability-001"],
      },
    ],
  };
  fixture.sourceTrust = {
    sourceStatus: "suspicious",
    actionChannelStatus: "suspicious",
    reason: "合成案例中的发件身份无法验证，邮件还要求在内嵌页面提交验证码。",
  };
  fixture.informationCompleteness = { status: "complete", gaps: [] };
  fixture.consequence = {
    level: "high",
    factState: "confirmed",
    reason: "按邮件要求提交账号和验证码可能导致账号被接管。",
    highConsequenceClue: true,
    claimRefs: ["claim-security-consequence-001"],
  };
  fixture.mailActions = [
    {
      id: "action-security-verify-001",
      origin: "mail",
      actor: "收件人",
      action: "输入",
      object: "账号与验证码",
      displayText: "通过邮件内嵌页面输入账号和验证码。",
      obligation: "mandatory",
      factState: "confirmed",
      condition: null,
      claimRefs: ["claim-security-action-001"],
    },
  ];
  fixture.managementSuggestions = [
    {
      id: "suggestion-security-verify-officially-001",
      origin: "ai_management_suggestion",
      safetyClass: "low_risk_personal_management",
      text: "不要使用邮件中的链接；如需核验，请手动进入学校官方主页。",
      reason: "这是降低钓鱼风险的个人管理建议，不是对邮件指令的确认。",
      claimRefs: ["claim-security-risk-001"],
    },
  ];
  fixture.dates = [];
  fixture.claims = [
    {
      id: "claim-security-applicability-001",
      kind: "applicability",
      text: "邮件声称面向当前账号持有人。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-security-audience-001"],
    },
    {
      id: "claim-security-action-001",
      kind: "action",
      text: "邮件要求收件人通过内嵌页面输入账号和验证码。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-security-action-001"],
    },
    {
      id: "claim-security-risk-001",
      kind: "risk",
      text: "发件身份和收集凭证的行动渠道均可疑。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-security-action-001"],
    },
    {
      id: "claim-security-consequence-001",
      kind: "consequence",
      text: "提交账号和验证码可能导致账号被接管。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-security-action-001"],
    },
  ];
  fixture.evidence = [
    {
      id: "evidence-security-audience-001",
      quote: "Your university account requires immediate verification.",
      location: { kind: "body", paragraph: 1 },
    },
    {
      id: "evidence-security-action-001",
      quote:
        "Open the page below and enter your university password and one-time verification code immediately.",
      location: { kind: "body", paragraph: 2 },
    },
  ];
  fixture.risks = [
    {
      id: "risk-security-phishing-001",
      type: "phishing",
      severity: "high",
      message: "不要点击邮件中的链接，也不要输入密码或验证码。",
      claimRefs: ["claim-security-risk-001"],
    },
    {
      id: "risk-security-credential-001",
      type: "credential_request",
      severity: "high",
      message: "学校通知不应要求通过邮件页面提交完整登录凭证。",
      claimRefs: ["claim-security-risk-001"],
    },
  ];
  fixture.unknowns = [
    {
      field: "source",
      message: "当前无法验证发件身份、域名归属或内嵌页面。",
      blockedCapabilities: ["openTrustedActionChannel"],
    },
  ];
  fixture.relation = {
    disposition: "new_item",
    matchState: "not_applicable",
    relatedItemId: null,
    explanation: "这是独立的合成安全提醒，没有匹配旧事项。",
  };
  fixture.states = {
    read: "unread",
    management: "active",
    item: "active",
    visibility: "active",
    due: "unknown",
    version: "current",
    updateKind: "none",
    previousVersionId: null,
    supersededByVersionId: null,
    mergedIntoId: null,
  };
  fixture.capabilityBinding.itemVersion = "synthetic-security-item-v1";
  fixture.capabilities.openTrustedActionChannel = {
    state: "blocked",
    decisionSource: "harness_policy",
    reasonCodes: ["source_suspicious", "security_conflict"],
    message: "来源与行动渠道可疑，禁止从邮件进入办理页面。",
  };
  fixture.capabilities.previewCalendar = {
    state: "not_applicable",
    decisionSource: "synthetic_fixture",
    reasonCodes: ["date_missing"],
    message: "这封合成安全邮件没有可靠日期。",
    eligibleDateIds: [],
  };

  return fixture;
}

function createCampusActivityFixture(): ActionCardViewModelInput {
  const fixture = cloneBaseFixture();

  fixture.notification = {
    id: "synthetic-notification-campus-001",
    schoolName: "维港都会大学（合成）",
    senderName: "合成学生发展处",
    senderAddress: "student-development@harbour-metropolitan.invalid",
    subject: "Harbour welcome fair on 12 September",
    sentAt: "2026-09-01T09:30:00+08:00",
    receivedAt: "2026-09-01T09:30:04+08:00",
    language: "en",
  };
  fixture.provenance.disclosure =
    "这是完全合成的校园活动案例，未调用模型、未连接邮箱，也不会发送报名或日历请求。";
  fixture.homeSection = "other";
  fixture.homeSectionExplanation =
    "这是面向全校的自愿校园活动，没有强制行动、重要标记或高后果，因此进入其他通知。";
  fixture.homeSectionClaimRefs = [
    "claim-campus-applicability-001",
    "claim-campus-summary-001",
    "claim-campus-consequence-001",
  ];
  fixture.nativeImportanceSignals = [
    {
      kind: "sender_importance",
      state: "absent",
      protection: "not_applicable",
    },
    {
      kind: "provider_importance",
      state: "absent",
      protection: "not_applicable",
    },
    {
      kind: "user_star",
      state: "absent",
      protection: "not_applicable",
    },
  ];
  fixture.title = "9 月 12 日维港迎新市集";
  fixture.titleClaimRefs = ["claim-campus-summary-001", "claim-campus-date-001"];
  fixture.summary =
    "学校将在 9 月 12 日 14:00 举办面向全校的迎新市集，可自由到场了解社团与校园服务，无需报名。";
  fixture.summaryClaimRefs = [
    "claim-campus-summary-001",
    "claim-campus-date-001",
  ];
  fixture.topics = ["campus_activity"];
  fixture.relevance = {
    scope: "schoolwide",
    factState: "confirmed",
    explanation: "邮件明确写明活动向所有在校生开放，与专业或课程无直接关系。",
    basis: [
      {
        id: "basis-campus-schoolwide-001",
        kind: "schoolwide",
        label: "合成邮件明确面向全校学生",
        claimRefs: ["claim-campus-applicability-001"],
      },
    ],
  };
  fixture.sourceTrust = {
    sourceStatus: "official_verified",
    actionChannelStatus: "not_required",
    reason: "此合成案例把学生发展处身份设为已验证，且邮件不要求进入外部办理渠道。",
  };
  fixture.informationCompleteness = { status: "complete", gaps: [] };
  fixture.consequence = {
    level: "low",
    factState: "confirmed",
    reason: "活动完全自愿，错过不会影响学籍、课程或资格。",
    highConsequenceClue: false,
    claimRefs: ["claim-campus-consequence-001"],
  };
  fixture.mailActions = [];
  fixture.managementSuggestions = [];
  fixture.dates = [
    {
      id: "date-campus-event-001",
      role: "event_start",
      originalText: "12 September 2026 at 2:00 pm Hong Kong time",
      factState: "confirmed",
      normalized: {
        kind: "date_time",
        value: "2026-09-12T14:00:00+08:00",
        timeZone: "Asia/Hong_Kong",
      },
      linkedActionIds: [],
      claimRefs: ["claim-campus-date-001"],
      calendarEligibility: {
        eligible: false,
        blockedReasonCode: "no_verified_mail_action",
      },
    },
  ];
  fixture.claims = [
    {
      id: "claim-campus-applicability-001",
      kind: "applicability",
      text: "活动面向全校学生开放。",
      highImpact: false,
      factState: "confirmed",
      evidenceIds: ["evidence-campus-summary-001"],
    },
    {
      id: "claim-campus-summary-001",
      kind: "summary",
      text: "学校举办可自由到场的迎新市集，无需报名。",
      highImpact: false,
      factState: "confirmed",
      evidenceIds: ["evidence-campus-summary-001"],
    },
    {
      id: "claim-campus-date-001",
      kind: "date",
      text: "活动开始时间为 2026 年 9 月 12 日 14:00（香港时间）。",
      highImpact: false,
      factState: "confirmed",
      evidenceIds: ["evidence-campus-date-001"],
    },
    {
      id: "claim-campus-consequence-001",
      kind: "consequence",
      text: "不参加不会影响任何学校资格。",
      highImpact: false,
      factState: "confirmed",
      evidenceIds: ["evidence-campus-summary-001"],
    },
  ];
  fixture.evidence = [
    {
      id: "evidence-campus-summary-001",
      quote:
        "The Harbour Welcome Fair is open to all students. Attendance is optional and no registration is required.",
      location: { kind: "body", paragraph: 1 },
    },
    {
      id: "evidence-campus-date-001",
      quote: "Join us at 2:00 pm Hong Kong time on 12 September 2026.",
      location: { kind: "body", paragraph: 2 },
    },
  ];
  fixture.risks = [];
  fixture.unknowns = [];
  fixture.relation = {
    disposition: "new_item",
    matchState: "not_applicable",
    relatedItemId: null,
    explanation: "这是独立的合成校园资讯，没有继承旧事项。",
  };
  fixture.states = {
    read: "unread",
    management: "active",
    item: "active",
    visibility: "active",
    due: "upcoming",
    version: "current",
    updateKind: "none",
    previousVersionId: null,
    supersededByVersionId: null,
    mergedIntoId: null,
  };
  fixture.capabilityBinding.itemVersion = "synthetic-campus-item-v1";
  fixture.capabilities.previewCalendar = {
    state: "not_applicable",
    decisionSource: "synthetic_fixture",
    reasonCodes: ["unsupported_for_item"],
    message: "这封合成通知没有可生成日历预览的已验证行动。",
    eligibleDateIds: [],
  };

  return fixture;
}

export const syntheticActionCardFixtures = [
  createPaymentDeadlineFixture(),
  syntheticActionCardFixture,
  createSecurityRiskFixture(),
  createCampusActivityFixture(),
] satisfies readonly ActionCardViewModelInput[];
