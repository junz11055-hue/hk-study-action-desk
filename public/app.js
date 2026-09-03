"use strict";

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

const dom = {
  authView: qs("#auth-view"),
  inviteForm: qs("#invite-form"),
  inviteCode: qs("#invite-code"),
  inviteError: qs("#invite-error"),
  inviteSubmit: qs("#invite-submit"),
  toggleCode: qs("#toggle-code"),
  workspace: qs("#workspace"),
  main: qs("#main-content"),
  appLive: qs("#app-live"),
  actionSummary: qs("#actions-summary"),
  actionList: qs("#action-list"),
  notificationList: qs("#notification-list"),
  guideList: qs("#guide-list"),
  stageRoute: qs("#stage-route"),
  managedList: qs("#managed-list"),
  profileContent: qs("#profile-content"),
  analyzeNext: qs("#analyze-next"),
  logoutButton: qs("#logout-button"),
  mobileLogoutButton: qs("#mobile-logout-button"),
  modelIndicator: qs("#model-indicator"),
  evidencePanel: qs("#evidence-panel"),
  evidenceHeading: qs("#evidence-heading"),
  evidenceEmpty: qs("#evidence-empty"),
  evidenceContent: qs("#evidence-content"),
  closeEvidence: qs("#close-evidence"),
  panelEvidence: qs("#panel-evidence"),
  panelOriginal: qs("#panel-original"),
  panelTranslation: qs("#panel-translation"),
  askOptions: qs("#ask-options"),
  askAnswer: qs("#ask-answer"),
  calendarDialog: qs("#calendar-dialog"),
  calendarFields: qs("#calendar-fields"),
  calendarEvidence: qs("#calendar-evidence"),
  simulateCalendar: qs("#simulate-calendar"),
  closeCalendar: qs("#close-calendar"),
  cancelCalendar: qs("#cancel-calendar"),
  toast: qs("#toast"),
};

const state = {
  authenticated: false,
  csrfToken: "",
  profile: null,
  messages: [],
  guides: [],
  modelStatus: null,
  demo: null,
  view: "actions",
  filter: "pending",
  selectedMessageId: null,
  detailTab: "evidence",
  lastEvidenceTrigger: null,
  busyMessageIds: new Set(),
  analysisPhases: new Map(),
  freshCardIds: new Set(),
  managedMessageIds: new Set(),
  managedGuideIds: new Set(),
  askAnswers: new Map(),
  askBusy: false,
  calendarContext: null,
  toastTimer: null,
};

const VIEW_NAMES = new Set(["actions", "notifications", "guides", "managed", "profile"]);
const FILTER_NAMES = new Set(["pending", "confirm", "all"]);
const DETAIL_TABS = ["evidence", "original", "translation"];
const QUESTION_LABELS = Object.freeze({
  what_to_do: "我具体要做什么？",
  deadline_evidence: "截止时间依据是什么？",
  what_is_uncertain: "哪些地方还不确定？",
});

const IMPORTANCE_LABELS = Object.freeze({
  critical: "非常紧急",
  high: "重要",
  medium: "一般",
  low: "低优先级",
});

const RISK_LABELS = Object.freeze({
  prompt_injection: "邮件含试图操纵 AI 的指令，已忽略",
  phishing: "内容可能是钓鱼诱导",
  date_conflict: "邮件中的日期存在冲突",
  unsupported_attachment: "有附件尚未可靠解析",
  sensitive_data_request: "邮件索取密码、验证码或其他敏感资料",
});

const SECURITY_RISK_FLAGS = new Set(["prompt_injection", "phishing", "sensitive_data_request"]);

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? "";
}

function apiErrorMessage(payload, fallback) {
  return firstString(
    payload?.error?.message,
    typeof payload?.error === "string" ? payload.error : "",
    payload?.message,
    fallback,
  );
}

async function apiRequest(path, { method = "GET", body, includeCsrf = true } = {}) {
  const headers = new Headers({ Accept: "application/json" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (includeCsrf && state.authenticated && method !== "GET") {
    headers.set("X-CSRF-Token", state.csrfToken);
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const responseText = await response.text();
  let payload = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    throw new ApiError(apiErrorMessage(payload, "请求未完成，请稍后重试。"), response.status, payload);
  }
  return payload;
}

function announce(message) {
  dom.appLive.textContent = "";
  window.setTimeout(() => {
    dom.appLive.textContent = message;
  }, 20);
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, 4200);
}

function safeExternalUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function getCard(message) {
  if (!isRecord(message)) return null;
  if (isRecord(message.card)) return message.card;
  if (isRecord(message.analysis) && typeof message.analysis.titleZh === "string") return message.analysis;
  return null;
}

function getMessage(messageId) {
  return state.messages.find((message) => message.id === messageId) ?? null;
}

function getPrimaryAction(card) {
  return asArray(card?.actions)[0] ?? null;
}

function getCalendarAction(card) {
  return asArray(card?.actions).find((action) => action?.calendarEligible && action?.dueAt) ?? null;
}

function getDateForAction(card, action) {
  if (!card || !action) return null;
  const dates = asArray(card.dates);
  const exact = dates.find((date) => date?.normalizedAt && date.normalizedAt === action.dueAt);
  if (exact) return exact;
  const actionEvidence = new Set(asArray(action.evidenceIds));
  return (
    dates.find((date) => asArray(date?.evidenceIds).some((id) => actionEvidence.has(id))) ??
    dates.find((date) => date?.status === "confirmed" && date?.normalizedAt) ??
    null
  );
}

function needsConfirmation(card) {
  if (!card) return false;
  if (card.appliesToUser === "uncertain") return true;
  return asArray(card.dates).some(
    (date) => date?.status === "ambiguous" || date?.confidence === "low" || !date?.normalizedAt,
  );
}

function hasSecurityRisk(card) {
  return asArray(card?.riskFlags).some((risk) => SECURITY_RISK_FLAGS.has(risk));
}

function canPreviewCalendar(card, action, date) {
  return Boolean(
    action?.calendarEligible &&
      action?.dueAt &&
      date?.id &&
      date.normalizedAt === action.dueAt &&
      date.timezone === "Asia/Hong_Kong" &&
      date.confidence !== "low" &&
      ["confirmed", "updated"].includes(date.status) &&
      card.appliesToUser !== "uncertain" &&
      !hasSecurityRisk(card),
  );
}

function formatReceived(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Hong_Kong",
  }).format(parsed);
}

function formatDeadline(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "日期需要确认";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Hong_Kong",
  }).formatToParts(parsed);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("month")}月${part("day")}日（${part("weekday")}）${part("hour")}:${part("minute")} · 香港时间`;
}

function formatCalendarValue(value) {
  if (!value) return "待确认";
  return formatDeadline(value);
}

function createBadge(label, modifier = "muted") {
  return element("span", `badge badge--${modifier}`, label);
}

function setAuthenticatedView(authenticated) {
  state.authenticated = authenticated;
  dom.authView.hidden = authenticated;
  dom.workspace.hidden = !authenticated;
  if (authenticated) {
    document.title = "要处理 · AI 留学管家演示";
  } else {
    document.title = "AI 留学管家 · 合成数据演示";
  }
}

function resetSessionUi() {
  state.csrfToken = "";
  state.profile = null;
  state.messages = [];
  state.guides = [];
  state.modelStatus = null;
  state.demo = null;
  state.selectedMessageId = null;
  state.busyMessageIds.clear();
  state.analysisPhases.clear();
  state.freshCardIds.clear();
  state.managedMessageIds.clear();
  state.managedGuideIds.clear();
  state.askAnswers.clear();
  closeEvidencePanel(false);
  if (dom.calendarDialog.open) dom.calendarDialog.close();
  setAuthenticatedView(false);
  dom.inviteForm.reset();
  dom.inviteCode.type = "password";
  dom.toggleCode.textContent = "显示";
  dom.toggleCode.setAttribute("aria-pressed", "false");
  dom.inviteError.textContent = "";
  dom.inviteCode.removeAttribute("aria-invalid");
  window.setTimeout(() => dom.inviteCode.focus(), 30);
}

function updateModelIndicator() {
  const status = state.modelStatus;
  const configured = isModelConfigured();
  const hasAiResult = state.messages.some(
    (message) =>
      ["ai", "ai_guarded"].includes(message.analysisMode ?? message._analysisMode) &&
      message.aiAvailable === true,
  );
  const hasPresetResult = state.messages.some(
    (message) => (message.analysisMode ?? message._analysisMode) === "preset" || message.aiAvailable === false,
  );
  const explicitlyUnavailable =
    status === "unavailable" ||
    status === "not_configured" ||
    status?.available === false ||
    status?.configured === false;

  dom.modelIndicator.classList.toggle("is-ready", hasAiResult);
  dom.modelIndicator.classList.toggle("is-unavailable", explicitlyUnavailable && !configured);
  const label = hasAiResult
    ? "DeepSeek 已调用"
    : configured && hasPresetResult
      ? "DeepSeek 已配置 · 本次使用安全预设"
      : configured
        ? "DeepSeek 已配置 · 尚未调用"
        : explicitlyUnavailable
          ? "未配置 DeepSeek · 使用安全预设"
          : "AI 状态由服务端确认";
  const labelNode = qs("span:last-child", dom.modelIndicator);
  if (labelNode) labelNode.textContent = label;
}

function isModelConfigured() {
  const status = state.modelStatus;
  return (
    status === "ready" ||
    status === "configured" ||
    status === "available" ||
    status?.configured === true
  );
}

function hydrateBootstrap(payload) {
  const source = isRecord(payload?.data) ? payload.data : payload;
  if (!isRecord(source)) throw new Error("演示数据格式不正确");

  state.profile = isRecord(source.profile) ? source.profile : {};
  state.messages = asArray(source.messages).map((message) => ({ ...message }));
  state.guides = asArray(source.guides).map((guide) => ({ ...guide }));
  state.csrfToken = firstString(source.csrfToken, source.csrf_token);
  state.modelStatus = source.modelStatus ?? null;
  state.demo = source.demo ?? null;
  state.view = "actions";
  state.filter = "pending";
  setAuthenticatedView(true);
  updateModelIndicator();
  renderAll();
  setView("actions", { focus: false });
}

async function loadBootstrap({ announceSuccess = false } = {}) {
  const payload = await apiRequest("/api/bootstrap");
  hydrateBootstrap(payload);
  if (announceSuccess) {
    announce("已进入合成数据演示。未连接真实邮箱或日历。");
    showToast("已进入合成数据演示");
  }
}

async function restoreSession() {
  try {
    await loadBootstrap();
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      dom.inviteError.textContent = "演示服务暂时不可用，请稍后刷新。";
    }
    setAuthenticatedView(false);
  }
}

async function submitInvite(event) {
  event.preventDefault();
  const code = dom.inviteCode.value.trim();
  dom.inviteError.textContent = "";
  dom.inviteCode.removeAttribute("aria-invalid");

  if (!code) {
    dom.inviteError.textContent = "请输入邀请码。";
    dom.inviteCode.setAttribute("aria-invalid", "true");
    dom.inviteCode.focus();
    return;
  }

  dom.inviteSubmit.disabled = true;
  dom.inviteSubmit.textContent = "正在验证…";
  try {
    const invitePayload = await apiRequest("/api/auth/invite", {
      method: "POST",
      body: { code },
      includeCsrf: false,
    });
    dom.inviteCode.value = "";
    const source = isRecord(invitePayload?.data) ? invitePayload.data : invitePayload;
    if (isRecord(source) && Array.isArray(source.messages)) {
      hydrateBootstrap(source);
      announce("已进入合成数据演示。未连接真实邮箱或日历。");
      showToast("已进入合成数据演示");
    } else {
      await loadBootstrap({ announceSuccess: true });
    }
  } catch {
    dom.inviteError.textContent = "此邀请码暂时无法使用，请检查后重试或联系邀请人。";
    dom.inviteCode.setAttribute("aria-invalid", "true");
    dom.inviteCode.focus();
  } finally {
    dom.inviteSubmit.disabled = false;
    dom.inviteSubmit.textContent = "验证邀请码";
  }
}

async function logout() {
  if (!state.authenticated) return;
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: {} });
    resetSessionUi();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      resetSessionUi();
      return;
    }
    showToast("暂时无法退出演示，请稍后重试。");
  }
}

function setView(viewName, { focus = true } = {}) {
  if (!VIEW_NAMES.has(viewName)) return;
  state.view = viewName;

  qsa("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== viewName;
  });
  qsa("[data-view]").forEach((button) => {
    const active = button.dataset.view === viewName;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  closeEvidencePanel(false);
  if (viewName === "managed") renderManaged();
  if (viewName === "guides") renderGuides();
  if (viewName === "profile") renderProfile();
  if (focus) {
    dom.main.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }
}

function setFilter(filterName) {
  if (!FILTER_NAMES.has(filterName)) return;
  state.filter = filterName;
  qsa("[data-filter]").forEach((button) => {
    const active = button.dataset.filter === filterName;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderActions();
}

function priorityScore(message) {
  const importance = getCard(message)?.importance;
  return { critical: 4, high: 3, medium: 2, low: 1 }[importance] ?? 0;
}

function filteredActionMessages() {
  return [...state.messages]
    .filter((message) => {
      const card = getCard(message);
      if (state.filter === "all") return true;
      if (state.filter === "confirm") return card && (needsConfirmation(card) || hasSecurityRisk(card));
      return !state.managedMessageIds.has(message.id);
    })
    .sort((a, b) => priorityScore(b) - priorityScore(a));
}

function makeCardKicker(message, card) {
  const kicker = element("div", "card-kicker");
  kicker.append(createBadge("合成邮件", "demo"));
  if (card) {
    const mode = message.analysisMode ?? message._analysisMode;
    if (mode === "preset" || message.aiAvailable === false) kicker.append(createBadge("安全预设", "muted"));
    else if (mode === "ai_guarded") kicker.append(createBadge("AI + 规则校验", "ai"));
    else kicker.append(createBadge("AI 行动卡", "ai"));
  }
  if (card?.importance === "critical") kicker.append(createBadge(IMPORTANCE_LABELS.critical, "critical"));
  else if (card?.importance === "high") kicker.append(createBadge(IMPORTANCE_LABELS.high, "ready"));
  if (needsConfirmation(card)) kicker.append(createBadge("请确认", "confirm"));
  if (hasSecurityRisk(card)) kicker.append(createBadge("安全提醒", "risk"));
  else if (asArray(card?.riskFlags).includes("date_conflict")) kicker.append(createBadge("日期已更新", "confirm"));
  if (state.managedMessageIds.has(message.id)) kicker.append(createBadge("已管理", "muted"));

  const sender = element("span", "", firstString(message.senderName, message.sender, "合成发件人"));
  const time = element("time", "", formatReceived(message.receivedAt));
  if (message.receivedAt) time.dateTime = message.receivedAt;
  kicker.append(sender, time);
  return kicker;
}

function openDetailsButton(message, card, triggerLabel) {
  const button = element("button", "card-title-button");
  button.type = "button";
  button.setAttribute("aria-label", `${triggerLabel}，查看原文依据`);
  const title = element("h2", "", firstString(card?.titleZh, message.subject, "未命名合成通知"));
  button.append(title);
  button.addEventListener("click", () => openEvidencePanel(message.id, "evidence", button));
  return button;
}

function routeStation(label, value, modifier, dateTime) {
  const item = element("li");
  const node = element("span", `route-node route-node--${modifier}`);
  node.setAttribute("aria-hidden", "true");
  const labelNode = element("span", "route-label", label);
  const valueNode = element("strong", "route-value");
  if (dateTime) {
    const time = element("time", "", value);
    time.dateTime = dateTime;
    valueNode.append(time);
  } else {
    valueNode.textContent = value;
  }
  item.append(node, labelNode, valueNode);
  return item;
}

function cardConclusion(card) {
  if (!card.isSchoolRelated) return "可能不是学校通知";
  if (card.appliesToUser === "no") return "可能与你无关";
  if (card.appliesToUser === "uncertain") return "请确认是否适用";
  return asArray(card.actions).some((action) => action.kind === "required") ? "需要你处理" : "供你了解";
}

function renderBusyCard(message) {
  const article = element("article", "action-card unanalyzed-card");
  article.dataset.messageId = message.id;
  article.append(makeCardKicker(message, null));
  article.append(openDetailsButton(message, null, firstString(message.subject, "合成通知")));

  const progress = element("div", "analysis-progress");
  const lead = element("p", "analysis-progress__lead");
  const pulse = element("span", "analysis-progress__pulse");
  pulse.setAttribute("aria-hidden", "true");
  lead.append(
    pulse,
    document.createTextNode(
      isModelConfigured() ? "AI 正在解析这封合成邮件" : "正在生成预置分析",
    ),
  );

  const phase = state.analysisPhases.get(message.id) ?? 0;
  const steps = element("ol", "analysis-steps");
  ["读取邮件", "提取行动", "核对日期"].forEach((label, index) => {
    const item = element("li", index === phase ? "is-current" : "", label);
    if (index === phase) item.setAttribute("aria-current", "step");
    steps.append(item);
  });
  progress.append(lead, steps);
  article.append(progress);
  return article;
}

function renderUnanalyzedCard(message) {
  const article = element("article", "action-card unanalyzed-card");
  article.dataset.messageId = message.id;
  article.append(makeCardKicker(message, null));
  article.append(openDetailsButton(message, null, firstString(message.subject, "合成通知")));
  article.append(
    element(
      "p",
      "card-summary",
      message._analysisError
        ? isModelConfigured()
          ? "AI 分析暂时没有完成。你仍可查看这封合成邮件的原文。"
          : "预置分析暂时没有完成。你仍可查看这封合成邮件的原文。"
        : isModelConfigured()
          ? "让 AI 判断这封合成通知是否与你有关，并提取行动、日期与逐字依据。"
          : "使用经过验证的安全预设，生成行动、日期与逐字依据。",
    ),
  );

  if (message._analysisError) {
    article.append(element("div", "card-alert card-alert--risk", "分析失败：未生成任何伪造行动卡。"));
  }

  const actions = element("div", "card-actions");
  const analyzeLabel = message._analysisError
    ? isModelConfigured()
      ? "重新分析"
      : "重新生成预置分析"
    : isModelConfigured()
      ? "让 AI 读懂"
      : "生成安全预设";
  const analyze = element("button", "button button--primary", analyzeLabel);
  analyze.type = "button";
  analyze.disabled = state.busyMessageIds.size > 0;
  analyze.addEventListener("click", () => analyzeMessage(message.id));
  const original = element("button", "card-action-link", "查看合成原文");
  original.type = "button";
  original.addEventListener("click", () => openEvidencePanel(message.id, "original", original));
  actions.append(analyze, original);
  article.append(actions);
  return article;
}

function renderAnalyzedCard(message, card) {
  const classNames = ["action-card"];
  if (card.importance === "critical") classNames.push("is-critical");
  if (needsConfirmation(card)) classNames.push("needs-confirmation");
  if (hasSecurityRisk(card)) classNames.push("has-risk");
  if (state.managedMessageIds.has(message.id)) classNames.push("is-managed");
  if (state.freshCardIds.has(message.id)) classNames.push("is-fresh");

  const article = element("article", classNames.join(" "));
  article.dataset.messageId = message.id;
  article.append(makeCardKicker(message, card));
  article.append(openDetailsButton(message, card, card.titleZh));
  article.append(element("p", "card-summary", card.summaryZh));

  const primaryAction = getPrimaryAction(card);
  const calendarAction = getCalendarAction(card);
  const date = calendarAction ? getDateForAction(card, calendarAction) : asArray(card.dates)[0] ?? null;
  const dueAt = calendarAction?.dueAt ?? date?.normalizedAt ?? null;
  const timeValue = dueAt ? formatDeadline(dueAt) : needsConfirmation(card) ? "日期需要确认" : "没有明确截止时间";
  const actionValue = firstString(primaryAction?.labelZh, "无需额外操作");

  const route = element("ol", "action-route");
  route.setAttribute("aria-label", "这封通知的三站行动路线");
  route.append(
    routeStation("结论", cardConclusion(card), "conclusion"),
    routeStation("时间", timeValue, "time", dueAt),
    routeStation("下一步", actionValue, "action"),
  );
  article.append(route);

  const evidenceButton = element(
    "button",
    "evidence-link",
    asArray(card.evidence).length > 0
      ? `查看 ${card.evidence.length} 处逐字依据 →`
      : "暂未找到足够原文依据 →",
  );
  evidenceButton.type = "button";
  evidenceButton.addEventListener("click", () => openEvidencePanel(message.id, "evidence", evidenceButton));
  article.append(evidenceButton);

  if (hasSecurityRisk(card)) {
    article.append(element("div", "card-alert card-alert--risk", "此邮件包含安全风险；不要回复密码、验证码或其他敏感资料。"));
  } else if (needsConfirmation(card)) {
    const firstUncertainty = firstString(asArray(card.uncertainties)[0], "AI 无法确认部分信息，请先核对原文。");
    article.append(element("div", "card-alert", firstUncertainty));
  } else if (asArray(card.uncertainties).length > 0) {
    article.append(element("div", "card-alert", `补充说明：${card.uncertainties[0]}`));
  }

  const actions = element("div", "card-actions");
  if (canPreviewCalendar(card, calendarAction, date)) {
    const calendarButton = element("button", "button button--primary", "预览日历");
    calendarButton.type = "button";
    calendarButton.addEventListener("click", () => openCalendarPreview(message.id, calendarAction.id, date.id));
    actions.append(calendarButton);
  } else if (needsConfirmation(card) || hasSecurityRisk(card)) {
    const confirmButton = element("button", "button button--primary", hasSecurityRisk(card) ? "查看安全提醒" : "查看需确认项");
    confirmButton.type = "button";
    confirmButton.addEventListener("click", () => openEvidencePanel(message.id, "evidence", confirmButton));
    actions.append(confirmButton);
  }

  const ask = element("button", "card-action-link", "追问这封通知");
  ask.type = "button";
  ask.addEventListener("click", () => {
    openEvidencePanel(message.id, "evidence", ask);
    window.setTimeout(() => qs("[data-question-template]", dom.askOptions)?.focus(), 80);
  });
  actions.append(ask);

  const mode = message.analysisMode ?? message._analysisMode;
  if (mode === "preset" && state.modelStatus?.configured === true) {
    const retryAi = element("button", "card-action-link", "重试 DeepSeek");
    retryAi.type = "button";
    retryAi.addEventListener("click", () => analyzeMessage(message.id));
    actions.append(retryAi);
  }

  const managed = state.managedMessageIds.has(message.id);
  const manage = element("button", "card-action-link", managed ? "移回待管理" : "标记已管理");
  manage.type = "button";
  manage.addEventListener("click", () => toggleManagedMessage(message.id));
  actions.append(manage);
  article.append(actions);

  if (state.freshCardIds.has(message.id)) {
    window.setTimeout(() => {
      state.freshCardIds.delete(message.id);
      article.classList.remove("is-fresh");
    }, 700);
  }
  return article;
}

function renderMessageCard(message) {
  if (state.busyMessageIds.has(message.id)) return renderBusyCard(message);
  const card = getCard(message);
  return card ? renderAnalyzedCard(message, card) : renderUnanalyzedCard(message);
}

function renderActions() {
  const unanalyzed = state.messages.filter((message) => !getCard(message)).length;
  const pending = state.messages.filter((message) => !state.managedMessageIds.has(message.id)).length;
  dom.actionSummary.textContent = isModelConfigured()
    ? `${pending} 封合成通知待管理，其中 ${unanalyzed} 封还没有经过 AI 分析。`
    : `${pending} 封合成通知待管理，其中 ${unanalyzed} 封还没有生成预置分析。`;
  dom.actionList.replaceChildren();
  dom.actionList.setAttribute("aria-busy", String(state.busyMessageIds.size > 0));
  const messages = filteredActionMessages();
  if (messages.length === 0) {
    dom.actionList.append(createEmptyState("✓", "这里暂时没有事项", state.filter === "confirm" ? "没有需要确认的行动卡。" : "你可以在“全部”中查看演示通知。"));
  } else {
    messages.forEach((message) => dom.actionList.append(renderMessageCard(message)));
  }
  dom.analyzeNext.disabled = state.busyMessageIds.size > 0 || !state.messages.some((message) => !getCard(message));
  dom.analyzeNext.textContent = state.busyMessageIds.size > 0
    ? isModelConfigured()
      ? "AI 正在解析…"
      : "正在生成预置分析…"
    : isModelConfigured()
      ? "让 AI 解析下一封"
      : "生成下一封安全预设";
}

function renderNotifications() {
  dom.notificationList.replaceChildren();
  if (state.messages.length === 0) {
    dom.notificationList.append(createEmptyState("0", "没有合成通知", "服务端尚未提供演示邮件。"));
    return;
  }
  state.messages.forEach((message) => {
    const card = getCard(message);
    const article = element("article", "notification-card");
    const button = element("button", "notification-card__button");
    button.type = "button";
    button.addEventListener("click", () => openEvidencePanel(message.id, card ? "evidence" : "original", button));
    const meta = element("div", "notification-card__meta");
    meta.append(element("span", "", firstString(message.senderName, message.sender, "合成发件人")));
    const time = element("time", "", formatReceived(message.receivedAt));
    if (message.receivedAt) time.dateTime = message.receivedAt;
    meta.append(time);
    button.append(meta);
    button.append(element("h2", "", firstString(card?.titleZh, message.subject, "合成通知")));
    if (card?.titleZh && message.subject) button.append(element("p", "notification-card__subject", message.subject));
    const status = element("div", "notification-card__status");
    if (state.busyMessageIds.has(message.id)) status.append(createBadge("AI 分析中", "ai"));
    else if (card) status.append(createBadge(needsConfirmation(card) ? "请确认" : "已有行动卡", needsConfirmation(card) ? "confirm" : "ready"));
    else status.append(createBadge("未分析", "muted"));
    article.append(button, status);
    dom.notificationList.append(article);
  });
}

function createEmptyState(mark, title, description) {
  const wrapper = element("div", "empty-state");
  wrapper.append(element("span", "empty-state__mark", mark));
  wrapper.append(element("h2", "", title));
  wrapper.append(element("p", "", description));
  return wrapper;
}

function renderStageRoute() {
  const stages = ["抵港前", "抵港初期", "安顿办理"];
  const current = firstString(state.profile?.stage, "抵港初期");
  let currentIndex = stages.findIndex((stage) => current.includes(stage));
  if (currentIndex < 0) currentIndex = 1;
  dom.stageRoute.replaceChildren();
  stages.forEach((stage, index) => {
    const stop = element("div", `stage-stop${index === currentIndex ? " is-current" : ""}`);
    if (index === currentIndex) stop.setAttribute("aria-current", "step");
    const node = element("span", "stage-stop__node");
    node.setAttribute("aria-hidden", "true");
    stop.append(node, element("span", "", stage));
    dom.stageRoute.append(stop);
  });
}

function renderGuides() {
  renderStageRoute();
  dom.guideList.replaceChildren();
  if (state.guides.length === 0) {
    dom.guideList.append(createEmptyState("—", "暂无阶段指南", "服务端尚未提供可核对的演示内容。"));
    return;
  }

  state.guides.forEach((guide) => {
    const card = element("article", "guide-card");
    const top = element("div", "guide-card__top");
    const heading = element("div");
    heading.append(element("p", "eyebrow", firstString(guide.stage, "演示阶段")));
    heading.append(element("h2", "", firstString(guide.title, "未命名指南")));
    top.append(heading, createBadge(guide.id === "bank-account" || guide.id === "hkid" ? "仅供核对" : "演示指南", guide.id === "bank-account" || guide.id === "hkid" ? "confirm" : "demo"));
    card.append(top);
    card.append(element("p", "guide-card__summary", firstString(guide.summary, "此演示指南尚无摘要。")));

    const checklistItems = asArray(guide.checklist);
    if (checklistItems.length > 0) {
      const checklist = element("ul", "guide-checklist");
      checklistItems.forEach((item) => checklist.append(element("li", "", item)));
      card.append(checklist);
    }

    const source = element("div", "guide-source");
    source.append(element("strong", "", "来源与有效期"));
    source.append(document.createTextNode(` · ${firstString(guide.sourceLabel, "来源待核对")} · ${firstString(guide.validThrough, "有效期待核对")}`));
    card.append(source);

    const actions = element("div", "guide-actions");
    const sourceUrl = safeExternalUrl(guide.sourceUrl);
    if (sourceUrl) {
      const link = element("a", "button button--secondary", "查看官方说明（新窗口）");
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      actions.append(link);
    }
    const managed = state.managedGuideIds.has(guide.id);
    const manage = element("button", "card-action-link", managed ? "移回待管理" : "标记已管理");
    manage.type = "button";
    manage.addEventListener("click", () => toggleManagedGuide(guide.id));
    actions.append(manage);
    card.append(actions);
    dom.guideList.append(card);
  });
}

function renderManaged() {
  dom.managedList.replaceChildren();
  const managedMessages = state.messages.filter((message) => state.managedMessageIds.has(message.id));
  const managedGuides = state.guides.filter((guide) => state.managedGuideIds.has(guide.id));
  if (managedMessages.length === 0 && managedGuides.length === 0) {
    dom.managedList.append(createEmptyState("✓", "还没有已管理事项", "你可以标记行动卡，或在日历预览中完成一次模拟操作。"));
    return;
  }
  managedMessages.forEach((message) => dom.managedList.append(renderMessageCard(message)));
  managedGuides.forEach((guide) => {
    const card = element("article", "guide-card");
    const top = element("div", "guide-card__top");
    const heading = element("div");
    heading.append(element("p", "eyebrow", "阶段指南 · 已管理"));
    heading.append(element("h2", "", firstString(guide.title, "演示指南")));
    top.append(heading, createBadge("已管理", "muted"));
    card.append(top, element("p", "guide-card__summary", firstString(guide.summary, "")));
    const moveBack = element("button", "card-action-link", "移回待管理");
    moveBack.type = "button";
    moveBack.addEventListener("click", () => toggleManagedGuide(guide.id));
    card.append(moveBack);
    dom.managedList.append(card);
  });
}

function renderProfile() {
  dom.profileContent.replaceChildren();
  const list = element("dl", "");
  const rows = [
    ["称呼", firstString(state.profile?.displayName, "演示用户")],
    ["学校", firstString(state.profile?.school, "完全合成学校")],
    ["课程", firstString(state.profile?.programme, "完全合成课程")],
    ["入学届别", firstString(state.profile?.cohort, "演示届别")],
    ["当前阶段", firstString(state.profile?.stage, "抵港初期")],
    ["处理时区", firstString(state.profile?.timezone, "Asia/Hong_Kong")],
    ["外部连接", "无真实邮箱或日历连接"],
  ];
  rows.forEach(([label, value]) => {
    const row = element("div", "profile-row");
    row.append(element("dt", "", label), element("dd", "", value));
    list.append(row);
  });
  dom.profileContent.append(list);
}

function renderAll() {
  renderActions();
  renderNotifications();
  renderGuides();
  renderManaged();
  renderProfile();
  if (state.selectedMessageId) renderEvidencePanel();
}

function toggleManagedMessage(messageId) {
  if (state.managedMessageIds.has(messageId)) {
    state.managedMessageIds.delete(messageId);
    showToast("已移回待管理；学校事项状态没有改变。");
  } else {
    state.managedMessageIds.add(messageId);
    showToast("已标记为管理过；这不代表学校事项已完成。");
  }
  renderActions();
  renderManaged();
}

function toggleManagedGuide(guideId) {
  if (state.managedGuideIds.has(guideId)) {
    state.managedGuideIds.delete(guideId);
    showToast("指南已移回待管理。");
  } else {
    state.managedGuideIds.add(guideId);
    showToast("指南已标记为管理过。");
  }
  renderGuides();
  renderManaged();
}

async function analyzeMessage(messageId) {
  if (state.busyMessageIds.size > 0 || state.busyMessageIds.has(messageId)) return;
  const message = getMessage(messageId);
  if (!message) return;

  state.busyMessageIds.add(messageId);
  state.analysisPhases.set(messageId, 0);
  message._analysisError = "";
  renderActions();
  renderNotifications();
  announce(
    isModelConfigured()
      ? "AI 开始分析一封合成邮件。"
      : "开始为一封合成邮件生成安全预设分析。",
  );

  const timers = [
    window.setTimeout(() => updateAnalysisPhase(messageId, 1), 650),
    window.setTimeout(() => updateAnalysisPhase(messageId, 2), 1500),
  ];

  try {
    const result = await apiRequest(`/api/messages/${encodeURIComponent(messageId)}/analyze`, {
      method: "POST",
      body: {},
    });
    const index = state.messages.findIndex((item) => item.id === messageId);
    if (index < 0) return;
    const returnedMessage = isRecord(result.message) ? result.message : {};
    const card = isRecord(result.card) ? result.card : getCard(returnedMessage);
    if (!card) throw new Error("服务端没有返回可验证的行动卡");
    state.messages[index] = {
      ...state.messages[index],
      ...returnedMessage,
      id: messageId,
      card,
      analysisMode: result.analysisMode ?? returnedMessage.analysisMode,
      aiAvailable: result.aiAvailable ?? returnedMessage.aiAvailable,
      cached: result.cached === true,
      notice: firstString(result.notice, returnedMessage.notice),
      _analysisError: "",
    };
    state.selectedMessageId = messageId;
    state.freshCardIds.add(messageId);
    updateModelIndicator();
    const usedRealModel =
      ["ai", "ai_guarded"].includes(state.messages[index].analysisMode) &&
      state.messages[index].aiAvailable === true;
    const notice = firstString(
      result.notice,
      result.cached
        ? "已复用这封邮件的现有分析。"
        : usedRealModel
          ? "AI 行动卡已生成。立刻查看原文依据再行动。"
          : "安全预设行动卡已生成。立刻查看原文依据再行动。",
    );
    showToast(notice);
    announce(
      usedRealModel
        ? "AI 行动卡已经生成，可以查看结论、日期和原文依据。"
        : "安全预设行动卡已经生成，可以查看结论、日期和原文依据。",
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      resetSessionUi();
      showToast("演示会话已结束，请重新输入邀请码。");
      return;
    }
    message._analysisError = "failed";
    showToast(
      isModelConfigured()
        ? "AI 分析暂时不可用；没有生成伪造行动卡。"
        : "预置分析暂时不可用；没有生成伪造行动卡。",
    );
    announce(
      isModelConfigured()
        ? "AI 分析没有完成。仍可查看合成邮件原文。"
        : "预置分析没有完成。仍可查看合成邮件原文。",
    );
  } finally {
    timers.forEach((timer) => window.clearTimeout(timer));
    state.busyMessageIds.delete(messageId);
    state.analysisPhases.delete(messageId);
    renderActions();
    renderNotifications();
    renderManaged();
    if (state.selectedMessageId === messageId) renderEvidencePanel();
  }
}

function updateAnalysisPhase(messageId, phase) {
  if (!state.busyMessageIds.has(messageId)) return;
  state.analysisPhases.set(messageId, phase);
  renderActions();
  renderNotifications();
}

function analyzeNextMessage() {
  const message = state.messages.find((item) => !getCard(item) && !state.busyMessageIds.has(item.id));
  if (!message) {
    showToast("所有合成邮件都已有分析结果。");
    return;
  }
  analyzeMessage(message.id);
}

function setDetailTab(tabName) {
  if (!DETAIL_TABS.includes(tabName)) return;
  state.detailTab = tabName;
  qsa("[data-detail-tab]").forEach((tab) => {
    const active = tab.dataset.detailTab === tabName;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  dom.panelEvidence.hidden = tabName !== "evidence";
  dom.panelOriginal.hidden = tabName !== "original";
  dom.panelTranslation.hidden = tabName !== "translation";
}

function openEvidencePanel(messageId, tabName = "evidence", trigger = null) {
  if (!getMessage(messageId)) return;
  state.selectedMessageId = messageId;
  state.lastEvidenceTrigger = trigger;
  state.askAnswers.delete(messageId);
  renderEvidencePanel();
  setDetailTab(tabName);
  dom.evidencePanel.classList.add("is-open");
  if (window.matchMedia("(max-width: 1199px)").matches) {
    dom.evidencePanel.setAttribute("role", "dialog");
    dom.evidencePanel.setAttribute("aria-modal", "true");
    dom.main.inert = true;
    qs(".sidebar")?.setAttribute("inert", "");
    qs(".mobile-nav")?.setAttribute("inert", "");
    window.setTimeout(() => dom.closeEvidence.focus(), 30);
  }
  ensureMessageBody(messageId);
}

function closeEvidencePanel(returnFocus = true) {
  dom.evidencePanel.classList.remove("is-open");
  dom.evidencePanel.removeAttribute("role");
  dom.evidencePanel.removeAttribute("aria-modal");
  dom.main.inert = false;
  qs(".sidebar")?.removeAttribute("inert");
  qs(".mobile-nav")?.removeAttribute("inert");
  if (returnFocus && state.lastEvidenceTrigger?.isConnected) state.lastEvidenceTrigger.focus();
}

function trapEvidenceFocus(event) {
  if (dom.evidencePanel.getAttribute("role") !== "dialog") return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeEvidencePanel();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = qsa(
    'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    dom.evidencePanel,
  ).filter((node) => !node.hidden && node.getClientRects().length > 0);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function ensureMessageBody(messageId) {
  const message = getMessage(messageId);
  if (!message || message.body || message._bodyLoading || message._bodyLoaded) return;
  message._bodyLoading = true;
  if (state.selectedMessageId === messageId) renderEvidencePanel();
  try {
    const result = await apiRequest(`/api/messages/${encodeURIComponent(messageId)}`);
    const returned = isRecord(result.message) ? result.message : result;
    if (isRecord(returned) && typeof returned.body === "string") {
      Object.assign(message, returned, { id: messageId, _bodyLoaded: true, _bodyError: false });
    } else {
      message._bodyLoaded = true;
      message._bodyError = true;
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      resetSessionUi();
      showToast("演示会话已结束，请重新输入邀请码。");
      return;
    }
    message._bodyLoaded = true;
    message._bodyError = true;
  } finally {
    message._bodyLoading = false;
    if (state.selectedMessageId === messageId && state.authenticated) renderEvidencePanel();
  }
}

function appendSourceMeta(container, message) {
  const meta = element("div", "source-meta");
  meta.append(element("strong", "", firstString(message.subject, "合成通知")));
  meta.append(element("span", "", `发件人：${firstString(message.senderName, message.sender, "合成发件人")}`));
  meta.append(element("span", "", `地址：${firstString(message.senderEmail, "合成地址未提供")}`));
  meta.append(element("span", "", `收到：${formatReceived(message.receivedAt)} · 香港时间`));
  container.append(meta);
}

function appendDetailList(container, title, items) {
  if (items.length === 0) return;
  const section = element("section", "detail-section");
  section.append(element("h3", "", title));
  const list = element("ul", "detail-list");
  items.forEach((item) => list.append(element("li", "", item)));
  section.append(list);
  container.append(section);
}

function renderEvidencePanel() {
  const message = getMessage(state.selectedMessageId);
  if (!message) {
    dom.evidenceEmpty.hidden = false;
    dom.evidenceContent.hidden = true;
    dom.evidenceHeading.textContent = "选择一张行动卡";
    return;
  }

  const card = getCard(message);
  dom.evidenceEmpty.hidden = true;
  dom.evidenceContent.hidden = false;
  dom.evidenceHeading.textContent = firstString(card?.titleZh, message.subject, "合成通知");
  dom.panelEvidence.replaceChildren();
  dom.panelOriginal.replaceChildren();
  dom.panelTranslation.replaceChildren();
  dom.askAnswer.replaceChildren();

  appendSourceMeta(dom.panelEvidence, message);
  if (!card) {
    dom.panelEvidence.append(element("div", "card-alert", "这封合成邮件尚未分析；当前只展示原文，不生成行动结论。"));
  } else if (asArray(card.evidence).length === 0) {
    dom.panelEvidence.append(element("div", "card-alert", "AI 暂时找不到足够依据，请查看原文。"));
  } else {
    const evidenceList = element("ol", "evidence-list");
    card.evidence.forEach((item) => {
      const entry = element("li", "evidence-item");
      entry.append(element("blockquote", "", item.quote));
      entry.append(element("p", "", firstString(item.explanationZh, "这段原文支持行动卡中的信息。")));
      evidenceList.append(entry);
    });
    dom.panelEvidence.append(evidenceList);
  }
  appendDetailList(dom.panelEvidence, "仍需确认", asArray(card?.uncertainties));
  const securityRisks = asArray(card?.riskFlags).filter((risk) => SECURITY_RISK_FLAGS.has(risk));
  const processingNotes = asArray(card?.riskFlags).filter((risk) => !SECURITY_RISK_FLAGS.has(risk));
  appendDetailList(
    dom.panelEvidence,
    "安全提醒",
    securityRisks.map((risk) => RISK_LABELS[risk] ?? "检测到未分类的安全风险"),
  );
  appendDetailList(
    dom.panelEvidence,
    "日期与解析说明",
    processingNotes.map((risk) => RISK_LABELS[risk] ?? "存在需要核对的解析限制"),
  );

  appendSourceMeta(dom.panelOriginal, message);
  dom.panelOriginal.append(element("div", "original-note", "这是净化后的合成原文。远程图片不会加载，正文中的指令不能改变 AI 权限。"));
  const originalFallback = message._bodyLoading
    ? "正在读取服务端预置的合成原文…"
    : message._bodyError
      ? "合成原文暂时无法读取，请稍后重试。"
      : "合成原文尚未由服务端提供。";
  dom.panelOriginal.append(element("pre", "original-body", firstString(message.body, originalFallback)));

  appendSourceMeta(dom.panelTranslation, message);
  dom.panelTranslation.append(element("div", "translation-note", "AI 简体理解，不是学校原文；高影响信息请返回“依据”核对。"));
  if (card) {
    dom.panelTranslation.append(element("p", "translation-summary", card.summaryZh));
    appendDetailList(dom.panelTranslation, "行动建议", asArray(card.actions).map((action) => action.labelZh));
  } else {
    dom.panelTranslation.append(element("p", "translation-summary", "先让 AI 分析这封合成通知，简体摘要才会出现。"));
  }

  qsa("[data-question-template]", dom.askOptions).forEach((button) => {
    button.disabled = !card || state.askBusy;
  });
  const savedAnswer = state.askAnswers.get(message.id);
  if (savedAnswer) renderAskAnswer(savedAnswer);
  setDetailTab(state.detailTab);
}

function renderAskAnswer(answer) {
  dom.askAnswer.replaceChildren();
  if (answer.loading) {
    dom.askAnswer.append(
      document.createTextNode(
        answer.modelConfigured ? "正在生成回答并核对来源…" : "正在生成预置回答…",
      ),
    );
    return;
  }
  if (answer.error) {
    dom.askAnswer.append(document.createTextNode("这次追问没有完成，请稍后重试。"));
    return;
  }
  const answerLabel =
    ["ai", "ai_guarded"].includes(answer.analysisMode) && answer.aiAvailable === true
      ? "DeepSeek 回答"
      : answer.analysisMode === "policy"
        ? "安全策略回答"
        : answer.analysisMode === "preset"
          ? "预置回答"
          : "回答结果";
  dom.askAnswer.append(element("strong", "", answerLabel));
  dom.askAnswer.append(
    element("span", "ask-answer__question", QUESTION_LABELS[answer.templateId] ?? "固定问题"),
  );
  dom.askAnswer.append(document.createTextNode(`\n${firstString(answer.answerZh, "当前通知没有足够信息回答。")}`));
  if (answer.notice) {
    dom.askAnswer.append(element("div", "ask-answer__notice", answer.notice));
  }
  const quotes = asArray(answer.evidenceQuotes);
  if (quotes.length > 0) {
    const evidence = element("div", "ask-answer__evidence");
    evidence.append(element("strong", "", "原文依据"));
    quotes.forEach((quote) => evidence.append(element("p", "", `“${quote}”`)));
    dom.askAnswer.append(evidence);
  }
  if (answer.uncertainty) {
    dom.askAnswer.append(element("div", "ask-answer__evidence", `不确定：${answer.uncertainty}`));
  }
}

async function askQuestion(templateId) {
  const messageId = state.selectedMessageId;
  if (!QUESTION_LABELS[templateId] || !messageId || state.askBusy || !getCard(getMessage(messageId))) return;
  state.askBusy = true;
  const loading = { templateId, loading: true, modelConfigured: isModelConfigured() };
  state.askAnswers.set(messageId, loading);
  renderAskAnswer(loading);
  qsa("[data-question-template]", dom.askOptions).forEach((button) => {
    button.disabled = true;
  });

  try {
    const result = await apiRequest(`/api/messages/${encodeURIComponent(messageId)}/ask`, {
      method: "POST",
      body: { questionTemplateId: templateId },
    });
    const source = isRecord(result.answer) ? result.answer : isRecord(result.followUp) ? result.followUp : result;
    const answer = {
      templateId,
      answerZh: firstString(source.answerZh, source.answer, source.text),
      evidenceQuotes: asArray(source.evidenceQuotes),
      uncertainty: typeof source.uncertainty === "string" ? source.uncertainty : null,
      analysisMode: firstString(result.analysisMode, source.analysisMode),
      aiAvailable:
        typeof result.aiAvailable === "boolean"
          ? result.aiAvailable
          : typeof source.aiAvailable === "boolean"
            ? source.aiAvailable
            : null,
      notice: firstString(result.notice, source.notice),
    };
    state.askAnswers.set(messageId, answer);
    renderAskAnswer(answer);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      resetSessionUi();
      showToast("演示会话已结束，请重新输入邀请码。");
      return;
    }
    const failed = { templateId, error: true };
    state.askAnswers.set(messageId, failed);
    renderAskAnswer(failed);
  } finally {
    state.askBusy = false;
    if (state.selectedMessageId === messageId) {
      qsa("[data-question-template]", dom.askOptions).forEach((button) => {
        button.disabled = false;
      });
    }
  }
}

function showCalendarDialog() {
  if (typeof dom.calendarDialog.showModal === "function") dom.calendarDialog.showModal();
  else dom.calendarDialog.setAttribute("open", "");
}

function closeCalendarDialog() {
  if (typeof dom.calendarDialog.close === "function" && dom.calendarDialog.open) dom.calendarDialog.close();
  else dom.calendarDialog.removeAttribute("open");
}

function calendarRow(label, value) {
  const row = element("div", "calendar-row");
  row.append(element("dt", "", label), element("dd", "", value));
  return row;
}

function normalizeCalendarPreview(result, message, action, date) {
  const source = isRecord(result.preview)
    ? result.preview
    : isRecord(result.calendarPreview)
      ? result.calendarPreview
      : result;
  return {
    title: firstString(source.title, source.summary, action.labelZh, getCard(message)?.titleZh),
    startAt: firstString(source.startAt, source.startsAt, source.start, date.normalizedAt, action.dueAt),
    endAt: firstString(source.endAt, source.endsAt, source.end),
    timezone: firstString(source.timezone, date.timezone, "Asia/Hong_Kong"),
    reminder: firstString(source.reminderLabel, source.reminder, source.reminderText, "提前 1 天（演示）"),
    calendarName: firstString(source.calendarName, source.targetCalendar, "演示日历"),
    evidenceQuote: firstString(source.evidenceQuote, source.sourceQuote),
  };
}

function renderCalendarPreview(preview, message, action, date) {
  dom.calendarFields.replaceChildren();
  const list = element("dl", "");
  list.append(calendarRow("标题", preview.title));
  list.append(calendarRow("时间", formatCalendarValue(preview.startAt)));
  if (preview.endAt) list.append(calendarRow("结束", formatCalendarValue(preview.endAt)));
  list.append(calendarRow("时区", preview.timezone));
  list.append(calendarRow("提醒", preview.reminder));
  list.append(calendarRow("目标", preview.calendarName));
  dom.calendarFields.append(list);

  dom.calendarEvidence.replaceChildren();
  const card = getCard(message);
  const evidenceId = asArray(action.evidenceIds)[0] ?? asArray(date.evidenceIds)[0];
  const evidence = asArray(card?.evidence).find((item) => item.id === evidenceId);
  const quote = firstString(preview.evidenceQuote, evidence?.quote);
  if (quote) {
    dom.calendarEvidence.append(element("strong", "", "日期原文依据"));
    dom.calendarEvidence.append(document.createTextNode(`“${quote}”`));
  } else {
    dom.calendarEvidence.append(element("strong", "", "没有足够日期依据，不能继续模拟加入。"));
  }

  state.calendarContext = { messageId: message.id, actionId: action.id, dateId: date.id, preview, allowed: Boolean(quote) };
  dom.simulateCalendar.disabled = !quote;
  dom.simulateCalendar.textContent = state.managedMessageIds.has(message.id) ? "撤销模拟操作" : "模拟加入日历";
}

async function openCalendarPreview(messageId, actionId, dateId) {
  const message = getMessage(messageId);
  const card = getCard(message);
  const action = asArray(card?.actions).find((item) => item.id === actionId);
  const date = asArray(card?.dates).find((item) => item.id === dateId);
  if (!message || !card || !action || !date) {
    showToast("无法生成可靠的日历预览。");
    return;
  }

  state.calendarContext = null;
  dom.calendarFields.replaceChildren(element("p", "field-help", "正在生成不产生外部写入的日历预览…"));
  dom.calendarEvidence.replaceChildren();
  dom.simulateCalendar.disabled = true;
  dom.simulateCalendar.textContent = "模拟加入日历";
  showCalendarDialog();

  try {
    const result = await apiRequest("/api/calendar/preview", {
      method: "POST",
      body: { messageId, actionId, dateId },
    });
    const preview = normalizeCalendarPreview(result, message, action, date);
    renderCalendarPreview(preview, message, action, date);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      closeCalendarDialog();
      resetSessionUi();
      showToast("演示会话已结束，请重新输入邀请码。");
      return;
    }
    dom.calendarFields.replaceChildren(
      element(
        "div",
        "card-alert card-alert--risk",
        error instanceof ApiError && error.status === 409
          ? "日期仍需确认，当前不能生成日历预览。"
          : "日历预览没有完成；不会执行任何外部操作。",
      ),
    );
    dom.simulateCalendar.disabled = true;
  }
}

function toggleCalendarSimulation() {
  const context = state.calendarContext;
  if (!context?.allowed) return;
  if (state.managedMessageIds.has(context.messageId)) {
    state.managedMessageIds.delete(context.messageId);
    dom.simulateCalendar.textContent = "模拟加入日历";
    showToast("已撤销页面内模拟操作；没有改动任何真实日历。");
  } else {
    state.managedMessageIds.add(context.messageId);
    dom.simulateCalendar.textContent = "撤销模拟操作";
    showToast("已加入演示日历；没有同步到任何真实日历。");
  }
  renderActions();
  renderManaged();
}

function bindEvents() {
  dom.inviteForm.addEventListener("submit", submitInvite);
  dom.toggleCode.addEventListener("click", () => {
    const show = dom.inviteCode.type === "password";
    dom.inviteCode.type = show ? "text" : "password";
    dom.toggleCode.textContent = show ? "隐藏" : "显示";
    dom.toggleCode.setAttribute("aria-pressed", String(show));
    dom.inviteCode.focus();
  });
  dom.inviteCode.addEventListener("input", () => {
    dom.inviteError.textContent = "";
    dom.inviteCode.removeAttribute("aria-invalid");
  });

  qsa("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  qsa("[data-view-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setView(link.dataset.viewLink);
    });
  });
  qsa("[data-open-profile]").forEach((button) => {
    button.addEventListener("click", () => setView("profile"));
  });
  qsa("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => setFilter(button.dataset.filter));
  });

  dom.analyzeNext.addEventListener("click", analyzeNextMessage);
  dom.logoutButton.addEventListener("click", logout);
  dom.mobileLogoutButton.addEventListener("click", logout);
  dom.closeEvidence.addEventListener("click", () => closeEvidencePanel());
  dom.evidencePanel.addEventListener("keydown", trapEvidenceFocus);

  qsa("[data-detail-tab]").forEach((tab) => {
    tab.addEventListener("click", () => setDetailTab(tab.dataset.detailTab));
    tab.addEventListener("keydown", (event) => {
      const currentIndex = DETAIL_TABS.indexOf(tab.dataset.detailTab);
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % DETAIL_TABS.length;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + DETAIL_TABS.length) % DETAIL_TABS.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = DETAIL_TABS.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      setDetailTab(DETAIL_TABS[nextIndex]);
      qs(`[data-detail-tab="${DETAIL_TABS[nextIndex]}"]`)?.focus();
    });
  });

  dom.askOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-question-template]");
    if (button) askQuestion(button.dataset.questionTemplate);
  });

  dom.closeCalendar.addEventListener("click", closeCalendarDialog);
  dom.cancelCalendar.addEventListener("click", closeCalendarDialog);
  dom.simulateCalendar.addEventListener("click", toggleCalendarSimulation);
  dom.calendarDialog.addEventListener("click", (event) => {
    if (event.target === dom.calendarDialog) closeCalendarDialog();
  });
}

bindEvents();
restoreSession();
