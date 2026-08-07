// server.js — 覺醒代碼《7天・把自己帶回來》LINE 官方帳號自動化 ＋ 依珊 AI 陪伴分身
// 功能：
//  1) 傳「開始」→ 啟動 7 天練習信，之後每晚 20:40 自動推下一封
//  2) 每封信附選項按鈕，點一下 → 收到對應的陪伴回覆
//  3) 選單關鍵字（關係檢視／報名／免費資源／學員故事／關於／找依珊）交給 LINE 內建自動回應
//  4) 其他自由文字 → 24 小時「依珊 AI 陪伴分身」即時回覆（溫馨、口語、有安全感）
//
// 需要環境變數：
//  LINE_CHANNEL_ACCESS_TOKEN、LINE_CHANNEL_SECRET、ANTHROPIC_API_KEY（AI 分身用）、CRON_SECRET、PORT(可選)

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const cron = require('node-cron');
const { letters, TOTAL_DAYS } = require('./letters');
const store = require('./store');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);
const app = express();

// 選單關鍵字：交給 LINE 內建自動回應，機器人不重複回（避免雙重訊息）
const MENU_KEYWORDS = /^(關係檢視|報名|課程|免費資源|學員故事|關於|找依珊)$/;
// 開始 7 天信
const START_KEYWORDS = /^(開始|7天|７天|start)$/i;

// ---------- 依珊 AI 陪伴分身 ----------
const SYSTEM_PROMPT = `妳是「依珊」的 AI 陪伴分身，暱稱可以說自己是「依珊的分身」或「小依」。妳在覺醒代碼・成長學院的官方 LINE 裡，24 小時陪伴來訊息的人。

【妳是誰】
- 妳像一位走過幽谷、願意誠實陪伴的姐姐，有時候帶一點媽媽的溫柔。妳沉靜、溫暖、有底蘊，但一點都不高高在上。
- 如果對方問妳是不是真人、是不是依珊本人：溫柔、誠實地說妳是依珊的 AI 分身，依珊本人也會不定時親自來看她。不要假裝是真人。

【怎麼說話】（最重要）
- 溫馨、口語，像跟一個很累的好朋友坐下來輕輕說話。短句、有呼吸感、可以留白。
- 有時候用一點疊字，帶媽媽的暖：慢慢來、好好的、乖乖、暖暖的、一點點、輕輕、抱抱、辛苦了。自然就好，不要每句都用。
- 先接住情緒，再說話。多一點「我懂」「我在」「妳願意說出來，就很不容易了」，少一點分析和建議。
- 回覆簡短，大約 2 到 5 句。不要長篇大論、不要條列清單、不要說教。

【妳的底蘊（只當內在，不可說出來）】
- 妳心裡有一套很穩的智慧：人的痛苦多來自習氣（慣性反應）、煩惱（情緒與執著）與過去累積；改變可以從每一個當下的覺察開始。無常提醒我們珍惜；放下執著，心就鬆了；對自己慈悲，是回家的路。
- 但妳「絕對不」引用經文、不講佛法名相、不當上師、不開示、不掉書袋、不用宗教術語。把這些智慧，全部化成很生活、很白話的溫柔話語。

【核心信念】
- 陪對方「回到自己」。常常自然地讓她感覺到：把自己帶回來，愛裡才真正有妳。

【界線與安全】
- 妳不做醫療或心理診斷、不做治療、不算命、不預言、不給保證、不評斷對錯。
- 不代替專業。若對方的狀況需要專業，溫柔鼓勵她找信任的人或專業協助。
- 如果對方談到想傷害自己、活不下去、撐不住想離開：先很溫柔地表達心疼與在乎，肯定她願意說出來，鼓勵她現在就聯絡願意聽她的人與專業資源（台灣安心專線 1925、生命線 1995，24 小時免費），並告訴她依珊本人看到也會來找她。不要追問細節、不要評判、不要說教。

【語言】一律用溫暖的繁體中文，稱呼對方「妳」。`;

const CRISIS = /(自殺|想死|不想活|活不下去|撐不下去|不想活了|結束(生命|自己|這一切)|傷害自己|自殘|割腕|了結|沒有意義活著|一了百了)/;

const CRISIS_REPLY =
  '聽到妳這樣說，我很心疼，也很擔心妳 🤍 妳願意把它說出來，已經很不容易了。\n' +
  '我是依珊的 AI 分身，怕在這種時刻沒辦法好好接住妳——但我真的不想妳一個人撐著。\n' +
  '可以的話，現在打給願意聽妳的人：台灣安心專線 1925、生命線 1995，都是 24 小時、免費、有真人陪妳。\n' +
  '也把這裡開著，依珊本人看到會來找妳。妳很重要，真的。';

const NOKEY_REPLY =
  '我在 🤍 妳想說的，都可以先留在這裡。依珊看到的時候，會親自回覆妳。';

async function askCompanion(userText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NOKEY_REPLY;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001', // 想更有深度可在 Render 設 AI_MODEL=claude-sonnet-5
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText.slice(0, 1500) }],
      }),
    });
    if (!r.ok) { console.error('anthropic', r.status, await r.text()); return NOKEY_REPLY; }
    const j = await r.json();
    const txt = j && j.content && j.content[0] && j.content[0].text;
    return (txt && txt.trim()) || NOKEY_REPLY;
  } catch (e) {
    console.error('askCompanion error', e.message);
    return NOKEY_REPLY;
  }
}

// 回覆（reply token 可能因冷啟動過期，失敗就改用 push）
async function safeReply(event, userId, text) {
  const msg = { type: 'text', text };
  try { await client.replyMessage(event.replyToken, msg); }
  catch (e) { try { await client.pushMessage(userId, msg); } catch (_) {} }
}

// ---------- 組 7 天信訊息 ----------
function buildDayMessages(dayNum) {
  const d = letters[dayNum];
  if (!d) return [];
  const msgs = [];
  msgs.push({ type: 'text', text: `Day ${dayNum}｜${d.title}` });
  d.bubbles.forEach(b => msgs.push({ type: 'text', text: b }));
  const items = d.quiz.options.slice(0, 13).map(o => ({
    type: 'action',
    action: { type: 'postback', label: o.label.slice(0, 20), data: `day=${dayNum}&opt=${o.key}`, displayText: o.label },
  }));
  const list = d.quiz.options.map(o => o.label).join('　');
  msgs.push({ type: 'text', text: `${d.quiz.question}\n${list}\n\n點一個最接近的，或直接打字告訴我。`, quickReply: { items } });
  let tail = `✦ 一句帶走\n${d.takeaway}\n\n${d.closing}`;
  if (d.medical) tail += `\n\n${d.medical}`;
  msgs.push({ type: 'text', text: tail });
  if (d.invite) msgs.push({ type: 'text', text: d.invite });
  return msgs;
}
async function pushMessages(userId, messages) {
  for (let i = 0; i < messages.length; i += 5) await client.pushMessage(userId, messages.slice(i, i + 5));
}
async function pushDay(userId, dayNum) { await pushMessages(userId, buildDayMessages(dayNum)); }

// ---------- Webhook ----------
app.post('/callback', line.middleware(config), async (req, res) => {
  try { await Promise.all(req.body.events.map(handleEvent)); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).end(); }
});

async function handleEvent(event) {
  const userId = event.source && event.source.userId;

  // 1) 加好友：由 LINE 內建歡迎訊息問候；這裡不重複發。
  if (event.type === 'follow') return;

  // 2) 文字訊息
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();

    // 2a) 開始 7 天信
    if (START_KEYWORDS.test(text)) {
      store.start(userId);
      await client.replyMessage(event.replyToken, { type: 'text', text: '好，我們開始 🤍 這是今晚的第一封信——' });
      await pushDay(userId, 1);
      return;
    }
    // 2b) 選單關鍵字：交給 LINE 內建自動回應，機器人不回（避免雙重）
    if (MENU_KEYWORDS.test(text)) return;

    // 2c) 危機關懷（優先）
    if (CRISIS.test(text)) { await safeReply(event, userId, CRISIS_REPLY); return; }

    // 2d) 其他自由文字 → 依珊 AI 陪伴分身
    const reply = await askCompanion(text);
    await safeReply(event, userId, reply);
    return;
  }

  // 3) 7 天信選項作答（postback）
  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback.data);
    const dayNum = Number(params.get('day'));
    const opt = letters[dayNum] && letters[dayNum].quiz.options.find(o => o.key === params.get('opt'));
    if (opt) {
      const replies = [{ type: 'text', text: opt.reply }];
      if (letters[dayNum].support) replies.push({ type: 'text', text: letters[dayNum].support });
      await client.replyMessage(event.replyToken, replies);
    }
    return;
  }
}

// ---------- 每日推播 ----------
async function runDailyPush() {
  const today = store.todayStr();
  let sent = 0;
  for (const u of store.list()) {
    if (u.day >= TOTAL_DAYS) continue;
    if (u.lastPushDate === today) continue;
    const next = u.day + 1;
    try { await pushDay(u.userId, next); store.update(u.userId, { day: next, lastPushDate: today }); sent++; }
    catch (e) { console.error('push fail', u.userId, e.message); }
  }
  return sent;
}
cron.schedule('40 20 * * *', runDailyPush, { timezone: 'Asia/Taipei' });

app.get('/cron/daily', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.key !== process.env.CRON_SECRET) return res.status(401).send('unauthorized');
  const sent = await runDailyPush();
  res.send(`ok, pushed ${sent}`);
});

app.get('/', (_, res) => res.send('覺醒代碼 LINE bot（7天信＋AI陪伴分身）is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on :${PORT}`));
