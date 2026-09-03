import { getPresetActionCard } from "../data/preset-action-cards.js";

export class SyntheticPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SyntheticPolicyError";
  }
}

const COMMON_FORBIDDEN = [
  /私人/,
  /个人(?:账户|户口)/,
  /非官方(?:账户|户口|链接)/,
  /回复.*(?:密码|验证码)/,
  /提供.*(?:密码|验证码|密钥|api\s*key)/i,
  /泄露.*(?:系统提示|邀请码|密钥|api\s*key)/i,
];

const CARD_LANGUAGE_POLICIES = Object.freeze({
  "deposit-deadline": {
    title: [/押金|留位费|订金|訂金/],
    summary: [
      /(?:20,?000|2万|两万).*港元/,
      /9月4日|4September/i,
      /Paid/i,
      /不(?:算|代表|等于).*完成|直到.*Paid|(?:须|需|必须).*Paid/i,
    ],
    forbidden: [...COMMON_FORBIDDEN, /无需.*Paid|不用.*Paid/i],
  },
  "orientation-update": {
    title: [/迎新|orientation/i],
    summary: [/改|更新|调整/, /9月3日/, /10(?:时|点|:00)/, /12(?:时|点|:00)|中午/],
    forbidden: COMMON_FORBIDDEN,
  },
  "course-registration": {
    title: [/选课|课程注册|課程註冊/],
    summary: [
      /9月9日/,
      /23:59|晚上11:59|11:59p\.?m\.?/i,
      /提交/,
      /草稿.*不|仅.*草稿.*不|保存.*草稿.*不/,
    ],
    forbidden: COMMON_FORBIDDEN,
  },
  "student-card-photo": {
    title: [/(?:学生证|學生證).*(?:照片|相片)|(?:照片|相片).*(?:学生证|學生證)/],
    summary: [
      /9月6日/,
      /18(?:时|点|:00)|下午6(?:时|点)/,
      /上传|上载|上傳/,
      /确认|接纳|接納/,
    ],
    forbidden: COMMON_FORBIDDEN,
  },
  "campus-newsletter": {
    title: [/校园|校園|社团|社團|迎新|campus/i],
    summary: [/无需.*报名|不需要.*报名|无需.*登记|不需要.*登记/, /没有.*截止|无.*截止/, /可选|自愿|選擇/],
    forbidden: COMMON_FORBIDDEN,
  },
});

const FOLLOW_UP_POLICIES = Object.freeze({
  "deposit-deadline": {
    what_to_do: [/缴|支付|付款/, /Paid|门户|門戶/i],
    deadline_evidence: [/9月4日|4September/i, /17:00|下午5|5:00p\.?m\.?/i],
    what_is_uncertain: [/付款入口|官方门户|官方門戶/],
  },
  "orientation-update": {
    what_to_do: [/迎新|参加|參加/, /日历|日曆|时间|時間/],
    deadline_evidence: [/9月3日/, /10(?:时|點|点|:00)/],
    what_is_uncertain: [/结束|結束|12|日历|日曆/],
  },
  "course-registration": {
    what_to_do: [/提交.*选课|提交.*選課|选课.*提交/, /冲突|衝突|课程办公室|課程辦公室/],
    deadline_evidence: [/9月9日/, /23:59|晚上11:59|11:59p\.?m\.?/i],
    what_is_uncertain: [/选课门户|選課門戶|入口/],
  },
  "student-card-photo": {
    what_to_do: [/上传|上载|上傳/, /照片|相片/],
    deadline_evidence: [/9月6日/, /18(?:时|点|點|:00)|下午6/],
    what_is_uncertain: [/规格|規格|尺寸|格式/],
  },
  "campus-newsletter": {
    what_to_do: [/浏览|查看|感兴趣|感興趣|社团|社團/],
    deadline_evidence: [/没有.*截止|无.*截止|沒有.*截止/],
    what_is_uncertain: [/时间|時間|地点|地點/],
  },
});

function compact(value) {
  return String(value).replace(/\s+/g, "");
}

function assertLanguagePolicy(value, checks, forbidden, label) {
  const normalized = compact(value);
  for (const check of checks) {
    if (!check.test(normalized)) {
      throw new SyntheticPolicyError(`${label} is missing a trusted synthetic fact`);
    }
  }
  for (const pattern of forbidden) {
    if (pattern.test(normalized)) {
      throw new SyntheticPolicyError(`${label} contains an unsafe or unsupported instruction`);
    }
  }
}

export function applySyntheticCardPolicy(candidate, email) {
  const canonical = getPresetActionCard(email.id);
  if (!canonical) throw new SyntheticPolicyError("No trusted policy exists for this synthetic message");

  if (email.id === "prompt-injection-phishing") {
    return {
      card: canonical,
      reason: "security_challenge_replaced",
    };
  }

  const policy = CARD_LANGUAGE_POLICIES[email.id];
  if (!policy) throw new SyntheticPolicyError("No language policy exists for this synthetic message");
  assertLanguagePolicy(candidate.titleZh, policy.title, policy.forbidden, "card.titleZh");
  assertLanguagePolicy(candidate.summaryZh, policy.summary, policy.forbidden, "card.summaryZh");

  return {
    card: {
      ...canonical,
      titleZh: candidate.titleZh,
      summaryZh: candidate.summaryZh,
      language: candidate.language,
    },
    reason: "high_impact_fields_canonicalized",
  };
}

export function applySyntheticFollowUpPolicy(candidate, email, questionTemplateId) {
  const checks = FOLLOW_UP_POLICIES[email.id]?.[questionTemplateId];
  if (!checks) throw new SyntheticPolicyError("No trusted follow-up policy exists for this question");
  assertLanguagePolicy(candidate.answerZh, checks, COMMON_FORBIDDEN, "followUp.answerZh");
  return candidate;
}
