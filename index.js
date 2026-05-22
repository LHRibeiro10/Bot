require("dotenv").config();
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const REQUIRED_ENVS = ["BOT_TOKEN", "TARGET_CHAT"];
const STATE_FILE = path.join(__dirname, "state.json");
const BOT_TIME_ZONE = process.env.BOT_TIME_ZONE || "America/Sao_Paulo";
const FIRST_ENTRY_BACKFILL = {
  entry: {
    id: "entry_manual_1",
    number: 1,
    valueCents: 10000,
    valueText: "R$100",
    odd: null,
    oddText: null,
    returnCents: 15163,
    returnText: "R$151,63",
    link: "",
    status: "green",
    createdAt: "2026-05-22T03:16:00.000Z",
    resultCents: 5163,
    closedAt: "2026-05-22T03:16:00.000Z",
  },
  result: {
    id: "result_manual_1",
    createdAt: "2026-05-22T03:16:00.000Z",
    type: "green",
    source: "manual-backfill",
    entryId: "entry_manual_1",
    number: 1,
    valueCents: 10000,
    returnCents: 15163,
    resultCents: 5163,
  },
};

function readRequiredEnv(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Variável obrigatória ausente no .env: ${name}`);
  }

  return value.trim();
}

function parseAdminIds() {
  const rawAdmins = process.env.ADMIN_IDS || process.env.ADMIN_ID;

  if (!rawAdmins || !rawAdmins.trim()) {
    throw new Error("Configure ADMIN_ID ou ADMIN_IDS no .env.");
  }

  const ids = rawAdmins
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  if (!ids.length) {
    throw new Error("ADMIN_ID/ADMIN_IDS inválido. Use IDs numéricos do Telegram.");
  }

  return new Set(ids);
}

for (const envName of REQUIRED_ENVS) {
  readRequiredEnv(envName);
}

const BOT_TOKEN = readRequiredEnv("BOT_TOKEN");
const TARGET_CHAT = readRequiredEnv("TARGET_CHAT");
const ADMIN_IDS = parseAdminIds();

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function logInfo(message, data = {}) {
  console.log(
    JSON.stringify({
      level: "info",
      at: new Date().toISOString(),
      message,
      ...data,
    })
  );
}

function logError(message, error, data = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      message,
      error: error?.message || String(error),
      ...data,
    })
  );
}

function isAdmin(msg) {
  return ADMIN_IDS.has(msg.from.id);
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getOrdinalEntrada(numero) {
  return `${numero}ª`;
}

function parseFields(text, expectedCount) {
  return text
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, expectedCount);
}

function parseCurrencyCents(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return null;
  }

  const sign = raw.includes("-") ? -1 : 1;
  const cleaned = raw.replace(/[^\d.,]/g, "");

  if (!/\d/.test(cleaned)) {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);

  let integerPart = cleaned.replace(/\D/g, "");
  let decimalPart = "";

  if (decimalIndex >= 0) {
    const left = cleaned.slice(0, decimalIndex);
    const right = cleaned.slice(decimalIndex + 1);
    const rightDigits = right.replace(/\D/g, "");

    if (rightDigits.length > 0 && rightDigits.length <= 2) {
      integerPart = left.replace(/\D/g, "") || "0";
      decimalPart = rightDigits.padEnd(2, "0").slice(0, 2);
    }
  }

  const reais = Number(integerPart || "0");
  const centavos = Number(decimalPart || "0");
  const totalCents = reais * 100 + centavos;

  if (!Number.isSafeInteger(totalCents)) {
    return null;
  }

  return sign * totalCents;
}

function formatIntegerBR(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatCurrencyBRL(cents, { signed = false } = {}) {
  const sign = cents < 0 ? "-" : signed && cents > 0 ? "+" : "";
  const absoluteCents = Math.abs(cents);
  const reais = Math.floor(absoluteCents / 100);
  const centavos = absoluteCents % 100;
  const decimal = centavos ? `,${String(centavos).padStart(2, "0")}` : "";

  return `${sign}R$${formatIntegerBR(reais)}${decimal}`;
}

function calculateGreenResult(valorEntrada, retorno) {
  const entradaCents = parseCurrencyCents(valorEntrada);
  const retornoCents = parseCurrencyCents(retorno);

  if (entradaCents === null || retornoCents === null) {
    return null;
  }

  return formatCurrencyBRL(retornoCents - entradaCents, { signed: true });
}

function isCurrencyLike(value) {
  return /r\$/i.test(String(value || "")) || String(value || "").includes("$");
}

function parseOdd(value) {
  const raw = String(value || "").trim();

  if (!raw || isCurrencyLike(raw)) {
    return null;
  }

  const normalized = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const odd = Number(normalized);

  if (!Number.isFinite(odd) || odd <= 1 || odd > 50) {
    return null;
  }

  return odd;
}

function formatOdd(odd) {
  return String(odd).replace(".", ",");
}

function calculateReturnFromOdd(valueCents, odd) {
  return Math.round(valueCents * odd);
}

function parseEntryNumber(value) {
  const number = Number(String(value || "").trim());

  if (!Number.isSafeInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function createInitialState() {
  return {
    version: 1,
    nextEntryNumber: 1,
    projectStartCents: null,
    entries: [],
    results: [],
  };
}

function normalizeState(rawState = {}) {
  const state = {
    ...createInitialState(),
    ...rawState,
    entries: Array.isArray(rawState.entries) ? rawState.entries : [],
    results: Array.isArray(rawState.results) ? rawState.results : [],
  };

  const highestEntryNumber = state.entries.reduce((highest, entry) => {
    return Math.max(highest, Number(entry.number) || 0);
  }, 0);

  state.nextEntryNumber = Math.max(
    Number(state.nextEntryNumber) || 1,
    highestEntryNumber + 1
  );

  return state;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return createInitialState();
  }

  try {
    const rawState = fs.readFileSync(STATE_FILE, "utf8");
    return normalizeState(JSON.parse(rawState));
  } catch (error) {
    const backupFile = `${STATE_FILE}.invalid-${Date.now()}`;
    fs.copyFileSync(STATE_FILE, backupFile);
    logError("state.json inválido; iniciando um estado novo", error, { backupFile });
    return createInitialState();
  }
}

function applyFirstEntryBackfill(state) {
  const hasEntries = state.entries.length > 0;
  const hasResults = state.results.length > 0;

  if (hasEntries || hasResults) {
    return false;
  }

  state.entries.push({ ...FIRST_ENTRY_BACKFILL.entry });
  state.results.push({ ...FIRST_ENTRY_BACKFILL.result });
  state.projectStartCents = FIRST_ENTRY_BACKFILL.entry.valueCents;
  state.nextEntryNumber = 2;
  return true;
}

function saveState() {
  const tempFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(appState, null, 2)}\n`);
  fs.renameSync(tempFile, STATE_FILE);
}

function refreshStateFromDisk() {
  appState = loadState();

  if (applyFirstEntryBackfill(appState)) {
    saveState();
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getNextEntryNumber() {
  return appState.nextEntryNumber;
}

function updateNextEntryNumber(number) {
  appState.nextEntryNumber = Math.max(appState.nextEntryNumber, number + 1);
}

function ensureProjectStart(valueCents) {
  if (appState.projectStartCents === null && Number.isSafeInteger(valueCents)) {
    appState.projectStartCents = valueCents;
  }
}

function registerPendingEntry(entry) {
  ensureProjectStart(entry.valueCents);
  updateNextEntryNumber(entry.number);
  appState.entries.push(entry);
}

function findEntryByNumber(number) {
  return appState.entries.find((entry) => entry.number === number);
}

function getLatestPendingEntry() {
  return appState.entries
    .filter((entry) => entry.status === "pending")
    .sort((a, b) => b.number - a.number)[0];
}

function recordResult(result) {
  appState.results.push({
    id: makeId("result"),
    createdAt: new Date().toISOString(),
    ...result,
  });
}

function closeEntry(entry, type, resultCents, source) {
  entry.status = type;
  entry.resultCents = resultCents;
  entry.closedAt = new Date().toISOString();

  recordResult({
    type,
    source,
    entryId: entry.id,
    number: entry.number,
    valueCents: entry.valueCents,
    returnCents: entry.returnCents,
    resultCents,
  });
}

function recordManualResult(type, resultCents, source, data = {}) {
  recordResult({
    type,
    source,
    resultCents,
    ...data,
  });
}

function buildEntradaFotoDraft(parts) {
  const hasExplicitNumber = parts.length >= 4;
  const number = hasExplicitNumber ? parseEntryNumber(parts[0]) : getNextEntryNumber();
  const valueText = hasExplicitNumber ? parts[1] : parts[0];
  const returnOrOddText = hasExplicitNumber ? parts[2] : parts[1];
  const link = hasExplicitNumber ? parts[3] : parts[2];

  if (!number) {
    return { error: "Número da entrada inválido. Use um número inteiro, como 1, 2 ou 3." };
  }

  if (hasExplicitNumber && findEntryByNumber(number)) {
    return { error: `A ${getOrdinalEntrada(number)} entrada já existe no histórico.` };
  }

  const valueCents = parseCurrencyCents(valueText);

  if (valueCents === null || valueCents <= 0) {
    return { error: "Valor de entrada inválido. Use algo como R$100 ou R$100,50." };
  }

  const odd = parseOdd(returnOrOddText);
  const returnCents =
    odd !== null
      ? calculateReturnFromOdd(valueCents, odd)
      : parseCurrencyCents(returnOrOddText);

  if (returnCents === null || returnCents <= 0) {
    return {
      error:
        "Não consegui entender o RETORNO/ODD. Use uma odd como 1.50 ou um retorno como R$150.",
    };
  }

  if (returnCents <= valueCents) {
    return { error: "O retorno precisa ser maior que o valor da entrada." };
  }

  return {
    entry: {
      id: makeId("entry"),
      number,
      valueCents,
      valueText: formatCurrencyBRL(valueCents),
      odd: odd,
      oddText: odd === null ? null : formatOdd(odd),
      returnCents,
      returnText: formatCurrencyBRL(returnCents),
      link,
      status: "pending",
      createdAt: new Date().toISOString(),
    },
  };
}

function buildGreenFotoDraft(parts) {
  if (parts.length === 0) {
    const entry = getLatestPendingEntry();

    if (!entry) {
      return {
        error:
          "Não encontrei entrada pendente. Poste uma /entradafoto antes ou informe manualmente: /greenfoto 1 | R$100 | R$150.",
      };
    }

    return {
      entry,
      number: entry.number,
      valueText: entry.valueText,
      returnText: entry.returnText,
      resultCents: entry.returnCents - entry.valueCents,
    };
  }

  if (parts.length === 1) {
    const number = parseEntryNumber(parts[0]);

    if (!number) {
      return { error: "Número da entrada inválido. Use algo como /greenfoto 2." };
    }

    const entry = findEntryByNumber(number);

    if (!entry) {
      return { error: `Não encontrei a ${getOrdinalEntrada(number)} entrada no histórico.` };
    }

    if (entry.status !== "pending") {
      return { error: `A ${getOrdinalEntrada(number)} entrada já foi finalizada como ${entry.status}.` };
    }

    return {
      entry,
      number: entry.number,
      valueText: entry.valueText,
      returnText: entry.returnText,
      resultCents: entry.returnCents - entry.valueCents,
    };
  }

  if (parts.length < 3) {
    return {
      error:
        "Formato inválido. Use /greenfoto, /greenfoto NÚMERO ou /greenfoto NÚMERO | VALOR_ENTRADA | RETORNO.",
    };
  }

  const number = parseEntryNumber(parts[0]);
  const valueCents = parseCurrencyCents(parts[1]);
  const returnCents = parseCurrencyCents(parts[2]);

  if (!number) {
    return { error: "Número da entrada inválido. Use um número inteiro, como 1, 2 ou 3." };
  }

  if (valueCents === null || valueCents <= 0) {
    return { error: "Valor de entrada inválido. Use algo como R$100 ou R$100,50." };
  }

  if (returnCents === null || returnCents <= 0) {
    return { error: "Retorno inválido. Use algo como R$150 ou R$150,50." };
  }

  const manualResultCents = parts[3] ? parseCurrencyCents(parts[3]) : null;

  if (parts[3] && manualResultCents === null) {
    return { error: "Resultado manual inválido. Use algo como +R$50." };
  }

  const resultCents =
    manualResultCents === null ? returnCents - valueCents : manualResultCents;

  if (resultCents <= 0) {
    return { error: "O resultado do green precisa ser positivo." };
  }

  const entry = findEntryByNumber(number);

  if (entry && entry.status !== "pending") {
    return { error: `A ${getOrdinalEntrada(number)} entrada já foi finalizada como ${entry.status}.` };
  }

  return {
    entry,
    number,
    valueText: formatCurrencyBRL(valueCents),
    returnText: formatCurrencyBRL(returnCents),
    resultCents,
  };
}

function buildRedDraft(text) {
  const raw = String(text || "").trim();

  if (!raw) {
    const entry = getLatestPendingEntry();

    if (!entry) {
      return {
        error:
          "Não encontrei entrada pendente. Use /red NÚMERO ou informe o prejuízo manualmente, como /red -R$100.",
      };
    }

    return {
      entry,
      number: entry.number,
      valueText: entry.valueText,
      resultCents: -entry.valueCents,
    };
  }

  const number = parseEntryNumber(raw);

  if (number) {
    const entry = findEntryByNumber(number);

    if (!entry) {
      return { error: `Não encontrei a ${getOrdinalEntrada(number)} entrada no histórico.` };
    }

    if (entry.status !== "pending") {
      return { error: `A ${getOrdinalEntrada(number)} entrada já foi finalizada como ${entry.status}.` };
    }

    return {
      entry,
      number: entry.number,
      valueText: entry.valueText,
      resultCents: -entry.valueCents,
    };
  }

  const lossCents = parseCurrencyCents(raw);

  if (lossCents === null || lossCents === 0) {
    return {
      error:
        "Prejuízo inválido. Use /red, /red NÚMERO ou informe um valor como /red -R$100.",
    };
  }

  return {
    resultCents: lossCents > 0 ? -lossCents : lossCents,
  };
}

function getDateKey(dateInput = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: BOT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(dateInput));

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function buildDailySummary() {
  const todayKey = getDateKey();
  const todaysResults = appState.results.filter(
    (result) => getDateKey(result.createdAt) === todayKey
  );
  const greens = todaysResults.filter((result) => result.type === "green").length;
  const reds = todaysResults.filter((result) => result.type === "red").length;
  const closed = greens + reds;
  const dailyTotal = todaysResults.reduce(
    (total, result) => total + (Number(result.resultCents) || 0),
    0
  );
  const allTimeTotal = appState.results.reduce(
    (total, result) => total + (Number(result.resultCents) || 0),
    0
  );
  const pending = appState.entries.filter((entry) => entry.status === "pending");
  const accuracy = closed ? Math.round((greens / closed) * 100) : 0;
  const projectStart = appState.projectStartCents;
  const projectLine =
    projectStart === null
      ? "Projeto: sem entradas registradas"
      : `Projeto: ${formatCurrencyBRL(projectStart)} → ${formatCurrencyBRL(
          projectStart + allTimeTotal
        )}`;

  return {
    greens,
    reds,
    closed,
    pendingCount: pending.length,
    latestPending: pending.sort((a, b) => b.number - a.number)[0],
    accuracy,
    dailyTotal,
    projectLine,
  };
}

function buildDailySummaryMessage() {
  const resumo = buildDailySummary();
  const pendente = resumo.latestPending
    ? `\n⏳ <b>Última pendente:</b> ${getOrdinalEntrada(resumo.latestPending.number)} entrada (${escapeHtml(
        resumo.latestPending.valueText
      )} → ${escapeHtml(resumo.latestPending.returnText)})`
    : "";

  return `
📊 <b>Resumo do dia</b>

✅ <b>Greens:</b> ${resumo.greens}
❌ <b>Reds:</b> ${resumo.reds}
🎯 <b>Assertividade:</b> ${resumo.closed ? `${resumo.accuracy}%` : "sem entradas finalizadas"}
📈 <b>Resultado do dia:</b> ${formatCurrencyBRL(resumo.dailyTotal, { signed: true })}
📌 <b>Pendentes:</b> ${resumo.pendingCount}${pendente}

💼 <b>${escapeHtml(resumo.projectLine)}</b>
`;
}

function isValidUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

function commandContext(msg, command) {
  return {
    command,
    userId: msg.from?.id,
    username: msg.from?.username,
    chatId: msg.chat?.id,
  };
}

async function denyIfNotAdmin(msg, action) {
  if (isAdmin(msg)) {
    return false;
  }

  logInfo("Comando bloqueado por falta de permissão", commandContext(msg, action));
  await bot.sendMessage(msg.chat.id, "Você não tem permissão para usar este comando.");
  return true;
}

async function sendTargetMessage(msg, command, sendFn) {
  try {
    await sendFn();
    logInfo("Postagem enviada", commandContext(msg, command));
    await bot.sendMessage(msg.chat.id, "Postagem enviada ✅");
    return true;
  } catch (error) {
    logError("Erro ao enviar postagem", error, commandContext(msg, command));
    await bot.sendMessage(
      msg.chat.id,
      "Deu erro ao postar. Confira o terminal e as permissões do bot no canal/grupo."
    );
    return false;
  }
}

async function clearMessageButtons(chatId, messageId) {
  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: messageId }
    );
  } catch (error) {
    logError("Erro ao remover botões da mensagem", error, { chatId, messageId });
  }
}

async function validateLinkOrReply(msg, link) {
  if (isValidUrl(link)) {
    return true;
  }

  await bot.sendMessage(
    msg.chat.id,
    "Link inválido. Use uma URL começando com http:// ou https://."
  );
  return false;
}

let appState = loadState();

if (applyFirstEntryBackfill(appState)) {
  saveState();
}

const pendingResumoMessages = new Map();

bot.onText(/\/start|\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Bot BadBoys Tips ativo ✅

Comandos:
/id - ver seu ID
/chatid - ver ID deste grupo/canal
/status - ver se o bot está configurado
/teste - testar envio
/resumo - prévia do resumo com confirmação para enviar ao grupo

/entrada CAMPEONATO | JOGO | MERCADO | ODD | UNIDADE | LINK
/entradafoto VALOR_ENTRADA | ODD | LINK
/entradafoto NÚMERO | VALOR_ENTRADA | RETORNO | LINK
/green JOGO | ODD | RETORNO
/greenfoto
/greenfoto NÚMERO
/greenfoto NÚMERO | VALOR_ENTRADA | RETORNO
/red
/red NÚMERO
/red PREJUÍZO

Exemplo:
/entradafoto R$100 | 1.50 | https://google.com
/greenfoto`
  );
});

bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `Seu ID é: ${msg.from.id}`);
});

bot.onText(/\/chatid/, (msg) => {
  bot.sendMessage(msg.chat.id, `ID deste chat é: ${msg.chat.id}`);
});

bot.onText(/\/status/, async (msg) => {
  if (await denyIfNotAdmin(msg, "status")) {
    return;
  }

  refreshStateFromDisk();

  bot.sendMessage(
    msg.chat.id,
    `Bot online ✅
Chat alvo: ${TARGET_CHAT}
Admins configurados: ${ADMIN_IDS.size}
Entradas pendentes: ${appState.entries.filter((entry) => entry.status === "pending").length}
Próxima entrada: ${getNextEntryNumber()}ª`
  );
});

bot.onText(/\/teste/, async (msg) => {
  if (await denyIfNotAdmin(msg, "teste")) {
    return;
  }

  await sendTargetMessage(msg, "teste", () =>
    bot.sendMessage(TARGET_CHAT, "Teste de postagem do bot ✅")
  );
});

bot.onText(/\/resumo/, async (msg) => {
  if (await denyIfNotAdmin(msg, "resumo")) {
    return;
  }

  refreshStateFromDisk();

  const requestId = makeId("rs");
  const mensagem = buildDailySummaryMessage();

  try {
    const preview = await bot.sendMessage(msg.from.id, mensagem, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Enviar no grupo",
              callback_data: `resumo_send:${requestId}`,
            },
          ],
          [
            {
              text: "Cancelar",
              callback_data: `resumo_cancel:${requestId}`,
            },
          ],
        ],
      },
    });

    pendingResumoMessages.set(requestId, {
      userId: msg.from.id,
      message: mensagem,
      chatId: preview.chat.id,
      messageId: preview.message_id,
      createdAt: Date.now(),
    });

    if (msg.chat.id !== msg.from.id) {
      await bot.sendMessage(msg.chat.id, "Te mandei o resumo no privado para confirmar o envio.");
    }
  } catch (error) {
    logError("Erro ao enviar preview do resumo no privado", error, commandContext(msg, "resumo"));
    await bot.sendMessage(
      msg.chat.id,
      "Não consegui te mandar o resumo no privado. Abra uma conversa com o bot e envie /start primeiro."
    );
  }
});

bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const match = /^resumo_(send|cancel):(.+)$/.exec(data);

  if (!match) {
    return;
  }

  const [, action, requestId] = match;
  const pending = pendingResumoMessages.get(requestId);

  if (!ADMIN_IDS.has(query.from.id)) {
    return bot.answerCallbackQuery(query.id, {
      text: "Você não tem permissão para confirmar este envio.",
      show_alert: true,
    });
  }

  if (!pending) {
    return bot.answerCallbackQuery(query.id, {
      text: "Essa confirmação expirou ou já foi usada.",
      show_alert: true,
    });
  }

  if (pending.userId !== query.from.id) {
    return bot.answerCallbackQuery(query.id, {
      text: "Essa confirmação pertence a outro admin.",
      show_alert: true,
    });
  }

  if (action === "cancel") {
    pendingResumoMessages.delete(requestId);
    await bot.answerCallbackQuery(query.id, { text: "Envio cancelado." });
    await clearMessageButtons(pending.chatId, pending.messageId);
    return bot.sendMessage(pending.chatId, "Envio do resumo cancelado.");
  }

  await bot.answerCallbackQuery(query.id, { text: "Enviando resumo..." });

  try {
    await bot.sendMessage(TARGET_CHAT, pending.message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    pendingResumoMessages.delete(requestId);
    await clearMessageButtons(pending.chatId, pending.messageId);
    logInfo("Resumo enviado após confirmação", {
      command: "resumo",
      userId: query.from.id,
      username: query.from.username,
      chatId: pending.chatId,
    });
    await bot.sendMessage(pending.chatId, "Resumo enviado no grupo ✅");
  } catch (error) {
    logError("Erro ao enviar resumo confirmado", error, {
      command: "resumo",
      userId: query.from.id,
      username: query.from.username,
      chatId: pending.chatId,
    });
    await bot.sendMessage(
      pending.chatId,
      "Deu erro ao enviar o resumo no grupo. Confira o terminal e as permissões do bot."
    );
  }
});

bot.onText(/\/entrada (.+)/, async (msg, match) => {
  if (await denyIfNotAdmin(msg, "entrada")) {
    return;
  }

  const partes = parseFields(match[1], 6);

  if (partes.length < 6) {
    return bot.sendMessage(
      msg.chat.id,
      `Formato inválido.

Use assim:
/entrada CAMPEONATO | JOGO | MERCADO | ODD | UNIDADE | LINK

Exemplo:
/entrada COPA DO BRASIL | Corinthians x Barra FC | Mais de 0.5 gol no 1º tempo + Corinthians vence | 1.73 | 1 unidade | https://google.com`
    );
  }

  const [campeonato, jogo, mercado, odd, unidade, link] = partes;

  if (!(await validateLinkOrReply(msg, link))) {
    return;
  }

  const mensagem = `
🟢 <b>Pré-Live FREE 🆓</b>

🏆 <b>${escapeHtml(campeonato)}</b>

⚽ <b>Pré-jogo</b>
🎯 <b>${escapeHtml(jogo)}</b>

📌 <b>Mercado:</b> ${escapeHtml(mercado)}
⭐ <b>ODD:</b> ${escapeHtml(odd)}
📈 <b>${escapeHtml(unidade)}</b>

🟩🟩🟩🟩🟩🟩🟩🟩

🔰 <b>PEGUE O BILHETE AQUI!</b>

+18 | Aposte com responsabilidade. Sem lucro garantido.
`;

  await sendTargetMessage(msg, "entrada", () =>
    bot.sendMessage(TARGET_CHAT, mensagem, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ PEGAR BILHETE",
              url: link,
            },
          ],
        ],
      },
    })
  );
});

bot.on("photo", async (msg) => {
  if (await denyIfNotAdmin(msg, "photo")) {
    return;
  }

  const caption = msg.caption || "";
  const foto = msg.photo?.[msg.photo.length - 1]?.file_id;

  if (!foto) {
    return bot.sendMessage(msg.chat.id, "Não consegui identificar a foto enviada.");
  }

  if (caption.startsWith("/entradafoto")) {
    const conteudo = caption.replace("/entradafoto", "").trim();
    const partes = parseFields(conteudo, 4);

    if (partes.length < 3) {
      return bot.sendMessage(
        msg.chat.id,
        `Formato inválido.

Envie a FOTO do bilhete com esta legenda:

/entradafoto VALOR_ENTRADA | ODD | LINK

Exemplo:
/entradafoto R$100 | 1.50 | https://google.com

Também aceito o formato antigo:
/entradafoto 1 | R$100 | R$150 | https://google.com`
      );
    }

    const draft = buildEntradaFotoDraft(partes);

    if (draft.error) {
      return bot.sendMessage(msg.chat.id, draft.error);
    }

    const { entry } = draft;

    if (!(await validateLinkOrReply(msg, entry.link))) {
      return;
    }

    const numero = escapeHtml(entry.number);
    const valor = escapeHtml(entry.valueText);
    const ganho = escapeHtml(entry.returnText);

    const legenda = `
⭐ <b>${getOrdinalEntrada(numero)} Entrada Projeto 1K 📊</b>

${getOrdinalEntrada(numero)} <b>${valor} → ${ganho}</b> 🚀🚀

<b>Dos ${valor} aos ${ganho}</b> 📈

<b>Copiar Bilhete na BET</b>

<i>+18 aposte com responsabilidade!</i>
`;

    return sendTargetMessage(msg, "entradafoto", () =>
      bot.sendPhoto(TARGET_CHAT, foto, {
        caption: legenda,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ COPIAR BILHETE",
                url: entry.link,
              },
            ],
          ],
        },
      }).then(() => {
        registerPendingEntry(entry);
        saveState();
      })
    );
  }

  if (caption.startsWith("/greenfoto")) {
    const conteudo = caption.replace("/greenfoto", "").trim();
    const partes = parseFields(conteudo, 4);

    const draft = buildGreenFotoDraft(partes);

    if (draft.error) {
      return bot.sendMessage(msg.chat.id, draft.error);
    }

    const numero = escapeHtml(draft.number);
    const valor = escapeHtml(draft.valueText);
    const ganho = escapeHtml(draft.returnText);
    const lucro = escapeHtml(formatCurrencyBRL(draft.resultCents, { signed: true }));

    const legenda = `
✅✅✅ <b>GREEN CONFIRMADO!</b> ✅✅✅

⭐ <b>${getOrdinalEntrada(numero)} Entrada Projeto 1K 📊</b>

${getOrdinalEntrada(numero)} <b>${valor} → ${ganho}</b> 🚀🚀

📈 <b>Resultado:</b> ${lucro}

🟩🟩🟩🟩🟩🟩🟩🟩

🔥 <b>Mais uma pra conta da tropa!</b>

<i>+18 aposte com responsabilidade!</i>
`;

    return sendTargetMessage(msg, "greenfoto", () =>
      bot.sendPhoto(TARGET_CHAT, foto, {
        caption: legenda,
        parse_mode: "HTML",
      }).then(() => {
        if (draft.entry) {
          closeEntry(draft.entry, "green", draft.resultCents, "greenfoto");
        } else {
          recordManualResult("green", draft.resultCents, "greenfoto", {
            number: draft.number,
            valueCents: parseCurrencyCents(draft.valueText),
            returnCents: parseCurrencyCents(draft.returnText),
          });
        }

        saveState();
      })
    );
  }

  return bot.sendMessage(
    msg.chat.id,
    "Foto recebida. Para postar, use a legenda /entradafoto ou /greenfoto."
  );
});

bot.onText(/\/green (.+)/, async (msg, match) => {
  if (await denyIfNotAdmin(msg, "green")) {
    return;
  }

  const partes = parseFields(match[1], 3);

  if (partes.length < 3) {
    return bot.sendMessage(
      msg.chat.id,
      `Formato inválido.

Use assim:
/green JOGO | ODD | RETORNO

Exemplo:
/green Corinthians x Barra FC | 1.73 | +0.73 unidade`
    );
  }

  const [jogo, odd, retorno] = partes;

  const mensagem = `
✅✅✅ <b>GREEN CONFIRMADO!</b> ✅✅✅

⚽ <b>Jogo:</b> ${escapeHtml(jogo)}
⭐ <b>ODD:</b> ${escapeHtml(odd)}
📈 <b>Retorno:</b> ${escapeHtml(retorno)}

🟩🟩🟩🟩🟩🟩🟩🟩

🔥 <b>Mais uma pra conta da tropa!</b>

+18 | Aposte com responsabilidade. Sem lucro garantido.
`;

  await sendTargetMessage(msg, "green", () =>
    bot.sendMessage(TARGET_CHAT, mensagem, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }).then(() => {
      if (isCurrencyLike(retorno)) {
        const resultCents = parseCurrencyCents(retorno);

        if (resultCents !== null && resultCents > 0) {
          recordManualResult("green", resultCents, "green");
          saveState();
        }
      }
    })
  );
});

bot.onText(/^\/red(?:\s+(.+))?$/, async (msg, match) => {
  if (await denyIfNotAdmin(msg, "red")) {
    return;
  }

  const draft = buildRedDraft(match[1]);

  if (draft.error) {
    return bot.sendMessage(msg.chat.id, draft.error);
  }

  const prejuizo = formatCurrencyBRL(draft.resultCents, { signed: true });
  const entrada = draft.number
    ? `\n⭐ <b>Entrada:</b> ${getOrdinalEntrada(escapeHtml(draft.number))} (${escapeHtml(
        draft.valueText
      )})`
    : "";

  const mensagem = `
❌ <b>RED NA ENTRADA</b>
${entrada}

📉 <b>Prejuízo:</b> ${escapeHtml(prejuizo)}

🟥🟥🟥🟥🟥🟥🟥🟥

🧠 <b>Calma e mental forte. Gestão acima de emoção.</b>

+18 | Aposte com responsabilidade. Sem lucro garantido.
`;

  await sendTargetMessage(msg, "red", () =>
    bot.sendMessage(TARGET_CHAT, mensagem, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }).then(() => {
      if (draft.entry) {
        closeEntry(draft.entry, "red", draft.resultCents, "red");
      } else {
        recordManualResult("red", draft.resultCents, "red");
      }

      saveState();
    })
  );
});

bot.on("polling_error", (error) => {
  logError("Erro no polling do Telegram", error);
});

bot.on("error", (error) => {
  logError("Erro geral do Telegram Bot", error);
});

process.on("unhandledRejection", (error) => {
  logError("Promise rejeitada sem tratamento", error);
});

process.on("uncaughtException", (error) => {
  logError("Exceção não capturada", error);
  process.exit(1);
});

logInfo("Bot rodando", {
  targetChat: TARGET_CHAT,
  adminCount: ADMIN_IDS.size,
});
