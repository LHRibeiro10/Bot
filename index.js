require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const REQUIRED_ENVS = ["BOT_TOKEN", "TARGET_CHAT"];

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
  } catch (error) {
    logError("Erro ao enviar postagem", error, commandContext(msg, command));
    await bot.sendMessage(
      msg.chat.id,
      "Deu erro ao postar. Confira o terminal e as permissões do bot no canal/grupo."
    );
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

bot.onText(/\/start|\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Bot BadBoys Tips ativo ✅

Comandos:
/id - ver seu ID
/chatid - ver ID deste grupo/canal
/status - ver se o bot está configurado
/teste - testar envio

/entrada CAMPEONATO | JOGO | MERCADO | ODD | UNIDADE | LINK
/entradafoto NÚMERO | VALOR_ENTRADA | RETORNO | LINK
/green JOGO | ODD | RETORNO
/greenfoto NÚMERO | VALOR_ENTRADA | RETORNO
/red PREJUÍZO

Exemplo:
/entrada COPA DO BRASIL | Corinthians x Barra FC | Mais de 0.5 gol no 1º tempo | 1.73 | 1 unidade | https://google.com`
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

  bot.sendMessage(
    msg.chat.id,
    `Bot online ✅
Chat alvo: ${TARGET_CHAT}
Admins configurados: ${ADMIN_IDS.size}`
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

    if (partes.length < 4) {
      return bot.sendMessage(
        msg.chat.id,
        `Formato inválido.

Envie a FOTO do bilhete com esta legenda:

/entradafoto NÚMERO | VALOR_ENTRADA | RETORNO | LINK

Exemplo:
/entradafoto 1 | R$100 | R$150 | https://google.com`
      );
    }

    const [numeroEntrada, valorEntrada, retorno, link] = partes;

    if (!(await validateLinkOrReply(msg, link))) {
      return;
    }

    const numero = escapeHtml(numeroEntrada);
    const valor = escapeHtml(valorEntrada);
    const ganho = escapeHtml(retorno);

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
                url: link,
              },
            ],
          ],
        },
      })
    );
  }

  if (caption.startsWith("/greenfoto")) {
    const conteudo = caption.replace("/greenfoto", "").trim();
    const partes = parseFields(conteudo, 4);

    if (partes.length < 3) {
      return bot.sendMessage(
        msg.chat.id,
        `Formato inválido.

Envie a FOTO do green com esta legenda:

/greenfoto NÚMERO | VALOR_ENTRADA | RETORNO

Exemplo:
/greenfoto 1 | R$100 | R$150`
      );
    }

    const [numeroEntrada, valorEntrada, retorno, resultadoManual] = partes;
    const resultadoCalculado = calculateGreenResult(valorEntrada, retorno);
    const resultado = resultadoManual || resultadoCalculado;

    if (!resultado) {
      return bot.sendMessage(
        msg.chat.id,
        `Não consegui calcular o resultado.

Use valores em reais no VALOR_ENTRADA e RETORNO:

/greenfoto 1 | R$100 | R$150

Se preferir, envie o RESULTADO manualmente como 4º campo.`
      );
    }

    const numero = escapeHtml(numeroEntrada);
    const valor = escapeHtml(valorEntrada);
    const ganho = escapeHtml(retorno);
    const lucro = escapeHtml(resultado);

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
    })
  );
});

bot.onText(/\/red (.+)/, async (msg, match) => {
  if (await denyIfNotAdmin(msg, "red")) {
    return;
  }

  const prejuizo = match[1].trim();

  if (!prejuizo) {
    return bot.sendMessage(
      msg.chat.id,
      `Formato inválido.

Use assim:
/red PREJUÍZO

Exemplo:
/red -R$100`
    );
  }

  const mensagem = `
❌ <b>RED NA ENTRADA</b>

📉 <b>Prejuízo:</b> ${escapeHtml(prejuizo)}

🟥🟥🟥🟥🟥🟥🟥🟥

🧠 <b>Calma e mental forte. Gestão acima de emoção.</b>

+18 | Aposte com responsabilidade. Sem lucro garantido.
`;

  await sendTargetMessage(msg, "red", () =>
    bot.sendMessage(TARGET_CHAT, mensagem, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
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
