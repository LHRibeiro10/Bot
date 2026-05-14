require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const TARGET_CHAT = process.env.TARGET_CHAT;
const ADMIN_ID = Number(process.env.ADMIN_ID);

function isAdmin(msg) {
  return !ADMIN_ID || msg.from.id === ADMIN_ID;
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

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Bot BadBoys Tips ativo ✅

Comandos:
/id - ver seu ID
/chatid - ver ID deste grupo/canal
/teste - testar envio

/entrada CAMPEONATO | JOGO | MERCADO | ODD | UNIDADE | LINK
/entradafoto NÚMERO | VALOR_ENTRADA | RETORNO | LINK
/green JOGO | ODD | RETORNO
/greenfoto NÚMERO | VALOR_ENTRADA | RETORNO | RESULTADO
/red PREJUÍZO

Para usar /entradafoto:
Envie uma FOTO com a legenda:
/entradafoto 1 | R$100 | R$150 | https://google.com

Para usar /greenfoto:
Envie uma FOTO com a legenda:
/greenfoto 1 | R$100 | R$150 | +R$50

Para usar /red:
/red -R$100`
  );
});

bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `Seu ID é: ${msg.from.id}`);
});

bot.onText(/\/chatid/, (msg) => {
  bot.sendMessage(msg.chat.id, `ID deste chat é: ${msg.chat.id}`);
});

bot.onText(/\/teste/, async (msg) => {
  try {
    if (!isAdmin(msg)) {
      return bot.sendMessage(msg.chat.id, "Você não tem permissão.");
    }

    await bot.sendMessage(TARGET_CHAT, "Teste de postagem do bot ✅");
    bot.sendMessage(msg.chat.id, "Mensagem de teste enviada ✅");
  } catch (error) {
    console.error(error);
    bot.sendMessage(msg.chat.id, "Erro ao enviar teste. Veja o terminal.");
  }
});

bot.onText(/\/entrada (.+)/, async (msg, match) => {
  try {
    if (!isAdmin(msg)) {
      return bot.sendMessage(
        msg.chat.id,
        "Você não tem permissão para postar entradas."
      );
    }

    const partes = match[1].split("|").map((p) => p.trim());

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

    await bot.sendMessage(TARGET_CHAT, mensagem, {
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
    });

    bot.sendMessage(msg.chat.id, "Entrada postada ✅");
  } catch (error) {
    console.error(error);
    bot.sendMessage(
      msg.chat.id,
      "Deu erro ao postar a entrada. Veja o terminal."
    );
  }
});

bot.on("photo", async (msg) => {
  try {
    if (!isAdmin(msg)) {
      return bot.sendMessage(
        msg.chat.id,
        "Você não tem permissão para postar imagens."
      );
    }

    const caption = msg.caption || "";
    const foto = msg.photo[msg.photo.length - 1].file_id;

    // =========================
    // ENTRADA COM FOTO
    // =========================
    if (caption.startsWith("/entradafoto")) {
      const conteudo = caption.replace("/entradafoto", "").trim();
      const partes = conteudo.split("|").map((p) => p.trim());

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

      const numero = escapeHtml(numeroEntrada);
      const valor = escapeHtml(valorEntrada);
      const ganho = escapeHtml(retorno);

      const legenda = `
⭐ <b>${getOrdinalEntrada(numero)} Entrada Projeto 1K 📊</b>

${getOrdinalEntrada(numero)} <b>${valor} —> ${ganho}</b> 🚀🚀

<b>Dos ${valor} aos ${ganho}</b> 📈

<b>Copiar Bilhete na BET</b>

<i>+18 aposte com responsabilidade!</i>
`;

      await bot.sendPhoto(TARGET_CHAT, foto, {
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
      });

      return bot.sendMessage(msg.chat.id, "Entrada com foto postada ✅");
    }

    // =========================
    // GREEN COM FOTO
    // =========================
    if (caption.startsWith("/greenfoto")) {
      const conteudo = caption.replace("/greenfoto", "").trim();
      const partes = conteudo.split("|").map((p) => p.trim());

      if (partes.length < 4) {
        return bot.sendMessage(
          msg.chat.id,
          `Formato inválido.

Envie a FOTO do green com esta legenda:

/greenfoto NÚMERO | VALOR_ENTRADA | RETORNO | RESULTADO

Exemplo:
/greenfoto 1 | R$100 | R$150 | +R$50`
        );
      }

      const [numeroEntrada, valorEntrada, retorno, resultado] = partes;

      const numero = escapeHtml(numeroEntrada);
      const valor = escapeHtml(valorEntrada);
      const ganho = escapeHtml(retorno);
      const lucro = escapeHtml(resultado);

      const legenda = `
✅✅✅ <b>GREEN CONFIRMADO!</b> ✅✅✅

⭐ <b>${getOrdinalEntrada(numero)} Entrada Projeto 1K 📊</b>

${getOrdinalEntrada(numero)} <b>${valor} —> ${ganho}</b> 🚀🚀

📈 <b>Resultado:</b> ${lucro}

🟩🟩🟩🟩🟩🟩🟩🟩

🔥 <b>Mais uma pra conta da tropa!</b>

<i>+18 aposte com responsabilidade!</i>
`;

      await bot.sendPhoto(TARGET_CHAT, foto, {
        caption: legenda,
        parse_mode: "HTML",
      });

      return bot.sendMessage(msg.chat.id, "Green com foto postado ✅");
    }
  } catch (error) {
    console.error(error);
    bot.sendMessage(
      msg.chat.id,
      "Deu erro ao postar a imagem. Veja o terminal."
    );
  }
});

bot.onText(/\/green (.+)/, async (msg, match) => {
  try {
    if (!isAdmin(msg)) {
      return bot.sendMessage(
        msg.chat.id,
        "Você não tem permissão para postar resultado."
      );
    }

    const partes = match[1].split("|").map((p) => p.trim());

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

    await bot.sendMessage(TARGET_CHAT, mensagem, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    bot.sendMessage(msg.chat.id, "Green postado ✅");
  } catch (error) {
    console.error(error);
    bot.sendMessage(
      msg.chat.id,
      "Deu erro ao postar o green. Veja o terminal."
    );
  }
});

bot.onText(/\/red (.+)/, async (msg, match) => {
  try {
    if (!isAdmin(msg)) {
      return bot.sendMessage(
        msg.chat.id,
        "Você não tem permissão para postar resultado."
      );
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

    await bot.sendMessage(TARGET_CHAT, mensagem, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    bot.sendMessage(msg.chat.id, "Red postado ✅");
  } catch (error) {
    console.error(error);
    bot.sendMessage(
      msg.chat.id,
      "Deu erro ao postar o red. Veja o terminal."
    );
  }
});

console.log("Bot rodando...");