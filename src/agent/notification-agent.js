import { ACTION_CARD_SCHEMA, FOLLOW_UP_SCHEMA } from "./action-card-schema.js";
import { ACTION_CARD_SYSTEM_PROMPT, FOLLOW_UP_SYSTEM_PROMPT } from "./prompts.js";
import { validateActionCard, validateFollowUp } from "./validation.js";
import { getPresetActionCard } from "../data/preset-action-cards.js";
import {
  applySyntheticCardPolicy,
  applySyntheticFollowUpPolicy,
} from "./synthetic-policy.js";

export const QUESTION_TEMPLATES = Object.freeze({
  what_to_do: "我现在具体要做什么？",
  deadline_evidence: "截止时间是什么，原文依据在哪里？",
  what_is_uncertain: "这封通知还有哪些信息不能确定？",
});

export class AgentUnavailableError extends Error {
  constructor(message = "AI analysis is temporarily unavailable") {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

function buildAnalysisInput(email, profile) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            task: "analyze_synthetic_school_email",
            dataClassification: "fully_synthetic_test_data",
            trustedSyntheticProfile: profile,
            untrustedSyntheticEmail: {
              id: email.id,
              senderName: email.senderName,
              senderEmail: email.senderEmail,
              subject: email.subject,
              receivedAt: email.receivedAt,
              language: email.language,
              body: email.body,
            },
          }),
        },
      ],
    },
  ];
}

function buildFollowUpInput(email, profile, card, questionTemplateId) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            task: "answer_fixed_question_about_synthetic_email",
            dataClassification: "fully_synthetic_test_data",
            question: QUESTION_TEMPLATES[questionTemplateId],
            trustedSyntheticProfile: profile,
            validatedActionCard: card,
            untrustedSyntheticEmail: {
              id: email.id,
              subject: email.subject,
              body: email.body,
            },
          }),
        },
      ],
    },
  ];
}

function presetFollowUp(email, card, questionTemplateId) {
  if (questionTemplateId === "what_to_do") {
    const actions = card.actions.map((action) => action.labelZh);
    return validateFollowUp(
      {
        answerZh:
          actions.length > 0
            ? `这封合成通知建议你：${actions.join("；")}。执行前请核对下方原文依据。`
            : "这封合成通知没有要求你完成具体事项，可以作为资讯查看。",
        evidenceQuotes: card.evidence.slice(0, 3).map((item) => item.quote),
        uncertainty: card.uncertainties[0] ?? null,
      },
      email,
    );
  }

  if (questionTemplateId === "deadline_evidence") {
    const confirmedDates = card.dates.filter((date) => date.normalizedAt !== null);
    return validateFollowUp(
      {
        answerZh:
          confirmedDates.length > 0
            ? `已抽取到 ${confirmedDates.length} 个日期：${confirmedDates
                .map((date) => `${date.raw}（${date.status === "updated" ? "更新后的日期" : "已确认"}）`)
                .join("；")}。日历功能在本版本中只生成预览，不会写入任何真实日历。`
            : "原文没有可确定的截止日期，因此不能生成日历预览。",
        evidenceQuotes: card.dates.flatMap((date) =>
          date.evidenceIds
            .map((id) => card.evidence.find((item) => item.id === id)?.quote)
            .filter(Boolean),
        ).slice(0, 5),
        uncertainty: card.uncertainties[0] ?? null,
      },
      email,
    );
  }

  return validateFollowUp(
    {
      answerZh:
        card.uncertainties.length > 0
          ? `仍需确认：${card.uncertainties.join("；")}`
          : "当前行动卡没有标出额外不确定项，但执行高影响事项前仍应核对学校官方入口。",
      evidenceQuotes: card.evidence.slice(0, 2).map((item) => item.quote),
      uncertainty: card.uncertainties.join("；") || null,
    },
    email,
  );
}

export function createNotificationAgent({
  modelClient,
  allowPresetFallback = true,
  logger,
}) {
  async function analyze(email, profile) {
    if (modelClient?.configured) {
      try {
        const candidate = await modelClient.createStructured({
          instructions: ACTION_CARD_SYSTEM_PROMPT,
          input: buildAnalysisInput(email, profile),
          schema: ACTION_CARD_SCHEMA,
          schemaName: "synthetic_notification_action_card_v1",
        });
        const validatedCandidate = validateActionCard(candidate, email);
        const guarded = applySyntheticCardPolicy(validatedCandidate, email);
        return {
          card: validateActionCard(guarded.card, email),
          analysisMode: "ai_guarded",
          aiAvailable: true,
          notice:
            guarded.reason === "security_challenge_replaced"
              ? "真实模型已处理合成攻击样本；高风险结果已由 Harness 安全策略替换。"
              : "真实模型生成了简体标题与摘要；行动、日期、风险和证据已由 Harness 冻结事实校验。",
        };
      } catch (error) {
        logger?.warn("agent_analysis_degraded", {
          messageId: email.id,
          reason: error?.message ?? "unknown",
        });
        if (!allowPresetFallback) throw new AgentUnavailableError();
      }
    } else if (!allowPresetFallback) {
      throw new AgentUnavailableError("DeepSeek API key is not configured");
    }

    const preset = getPresetActionCard(email.id);
    if (!preset) throw new AgentUnavailableError("No preset analysis is available");
    return {
      card: validateActionCard(preset, email),
      analysisMode: "preset",
      aiAvailable: false,
      notice: modelClient?.configured
        ? "真实模型本次调用失败；当前展示的是明确标记的预置合成分析。"
        : "当前未配置 DEEPSEEK_API_KEY；展示的是预置合成分析，不代表真实模型已调用。",
    };
  }

  async function answer(email, profile, card, questionTemplateId) {
    if (!(questionTemplateId in QUESTION_TEMPLATES)) {
      throw new TypeError("Unsupported question template");
    }

    if (email.id === "prompt-injection-phishing") {
      return {
        followUp: presetFollowUp(email, card, questionTemplateId),
        analysisMode: "policy",
        aiAvailable: false,
        notice: "安全挑战通知不进入模型追问；当前回答来自确定性安全策略。",
      };
    }

    if (modelClient?.configured) {
      try {
        const candidate = await modelClient.createStructured({
          instructions: FOLLOW_UP_SYSTEM_PROMPT,
          input: buildFollowUpInput(email, profile, card, questionTemplateId),
          schema: FOLLOW_UP_SCHEMA,
          schemaName: "synthetic_notification_follow_up_v1",
        });
        const validated = validateFollowUp(candidate, email);
        return {
          followUp: applySyntheticFollowUpPolicy(validated, email, questionTemplateId),
          analysisMode: "ai_guarded",
          aiAvailable: true,
          notice: "此回答由真实模型生成，并通过当前合成通知的固定事实策略。",
        };
      } catch (error) {
        logger?.warn("agent_follow_up_degraded", {
          messageId: email.id,
          questionTemplateId,
          reason: error?.message ?? "unknown",
        });
        if (!allowPresetFallback) throw new AgentUnavailableError();
      }
    } else if (!allowPresetFallback) {
      throw new AgentUnavailableError("DeepSeek API key is not configured");
    }

    return {
      followUp: presetFollowUp(email, card, questionTemplateId),
      analysisMode: "preset",
      aiAvailable: false,
      notice: modelClient?.configured
        ? "真实模型本次调用失败；当前回答来自明确标记的预置逻辑。"
        : "当前未配置 DEEPSEEK_API_KEY；回答来自预置逻辑，不代表真实模型已调用。",
    };
  }

  return Object.freeze({ analyze, answer });
}
