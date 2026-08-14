// server.js — 覺醒代碼《7天・把自己帶回來》LINE 官方帳號自動化
// 功能：
//  1) 加好友 或 傳「7天」→ 立刻開始，寄出 Day 1
//  2) 每天早晨 07:30（台北時間）自動推播下一天的信（Day 2～7）
//  3) 每封信附「選擇題」快速回覆按鈕，使用者點一下 → 立刻收到對應的陪伴回覆
//
// 需要環境變數（見 .env.example）：
//  LINE_CHANNEL_ACCESS_TOKEN、LINE_CHANNEL_SECRET、PORT（可選，預設 3000）

require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const cron = require('node-cron');
const { letters, TOTAL_DAYS } = require('./letters');
const store = require('./store');
const ai = require('./ai_yishan');

// ---------- 「找依珊」AI 對話用文案 ----------
const AI_INTRO =
  '我在這裡 🤍\n' +
  '接下來會先由「AI 依珊」陪妳整理現在的感受。她讀過覺醒代碼的陪伴方法，但她不是依珊本人，也不取代心理師或醫療。\n' +
  '妳現在最想說的是什麼？直接告訴我就好。任何時候想找依珊本人，輸入「轉真人」就可以。';
const AI_HANDOFF =
  '好，我已經幫妳標記，會請依珊本人盡快與妳聯繫。🤍 在這之前如果妳願意，也可以先跟我說說現在的心情。';
const AI_RESTART = '好，我們重新開始，剛剛的對話我先放下了。妳現在想說什麼？';
const AI_DELETED = '我已經把我們的對話紀錄清除了。任何時候想再聊，我都在。🤍';
const AI_EXIT = '好，先到這裡。任何時候想再聊，回覆「找依珊」就可以。好好照顧妳自己。🤍';
const AI_RELATIONSHIP =
  '「關係檢視」是陪妳看清這段關係的狀態與自己的位置——不是替妳做決定，而是幫妳把混亂理清楚。\n' +
  '想更完整地進行，回覆「轉真人」由依珊本人陪妳；現在也可以先跟我說，最讓妳困擾的是什麼。';

// 進入 AI 模式並送出開場白
async function enterAiMode(userId, replyToken) {
  store.setMode(userId, 'ai');
  store.clearChat(userId);
  await client.replyMessage(replyToken, { type: 'text', text: AI_INTRO });
}

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);
const app = express();

// ---------- 組訊息 ----------
// 把某一天的內容組成一組 LINE 訊息（多個文字泡泡 + 最後一則帶選擇題快速回覆）
function buildDayMessages(dayNum) {
  const d = letters[dayNum];
  if (!d) return [];
  const msgs = [];

  // 開頭標記
  msgs.push({ type: 'text', text: `Day ${dayNum}｜${d.title}` });

  // 推播泡泡
  d.bubbles.forEach(b => msgs.push({ type: 'text', text: b }));

  // 選擇題（最後一則，附 Quick Reply）
  const items = d.quiz.options.slice(0, 13).map(o => ({
    type: 'action',
    action: {
      type: 'postback',
      label: o.label.slice(0, 20),          // 按鈕文字上限 20 字
      data: `day=${dayNum}&opt=${o.key}`,
      displayText: o.label                    // 使用者畫面上會顯示他點了什麼
    }
  }));
  msgs.push({
    type: 'text',
    text: `【今日選擇題】${d.quiz.question}\n（點一個最接近的就好）`,
    quickReply: { items }
  });

  // 一句帶走 + 固定收尾
  msgs.push({ type: 'text', text: `✦ 一句帶走\n${d.takeaway}\n\n${d.closing}` });

  // 第七天的邀請
  if (d.invite) msgs.push({ type: 'text', text: d.invite });

  // LINE 一次回覆最多 5 則；超過就分批（見 pushDay）
  return msgs;
}

// 分批推播（LINE 單次上限 5 則）
async function pushMessages(userId, messages) {
  for (let i = 0; i < messages.length; i += 5) {
    await client.pushMessage(userId, messages.slice(i, i + 5));
  }
}

async function pushDay(userId, dayNum) {
  await pushMessages(userId, buildDayMessages(dayNum));
}

// ---------- Webhook ----------
app.post('/callback', line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  const userId = event.source && event.source.userId;

  // 1) 加好友 → 歡迎 + 開始 Day1
  if (event.type === 'follow') {
    store.start(userId);
    await pushMessages(userId, [
      { type: 'text', text: '嗨，我是覺醒代碼。歡迎妳，願意給自己這 7 天。🤍' },
      { type: 'text', text: '接下來 7 天，每天早晨我會寄一封短信給妳，一個五分鐘的小練習。今天，我們先從第一封開始。' }
    ]);
    await pushDay(userId, 1);
    return;
  }

  // 2) 文字訊息
  if (event.type === 'message' && event.message.type === 'text') {
    const userText = event.message.text.trim();
    const user = store.get(userId);
    const inAi = user && user.mode === 'ai';

    // (a) 全域指令：找依珊 → 進入 AI 陪伴模式
    if (/^(找依珊|我想找依珊|想聊聊|陪我)$/i.test(userText)) {
      await enterAiMode(userId, event.replyToken);
      return;
    }
    // (b) 全域指令：轉真人（任何情況都可）
    if (/^(轉真人|找真人|真人|轉接真人|找依珊本人)$/i.test(userText)) {
      store.requestHuman(userId, true);
      await client.replyMessage(event.replyToken, { type: 'text', text: AI_HANDOFF });
      return;
    }

    // (c) AI 模式中
    if (inAi) {
      if (/^(重新開始|重來)$/.test(userText)) {
        store.clearChat(userId);
        await client.replyMessage(event.replyToken, { type: 'text', text: AI_RESTART });
        return;
      }
      if (/^(刪除紀錄|刪除記錄|清除紀錄|刪除對話|清除對話)$/.test(userText)) {
        store.clearChat(userId);
        await client.replyMessage(event.replyToken, { type: 'text', text: AI_DELETED });
        return;
      }
      if (/^(結束|離開|退出|結束對話|不聊了)$/.test(userText)) {
        store.setMode(userId, null);
        await client.replyMessage(event.replyToken, { type: 'text', text: AI_EXIT });
        return;
      }
      if (/^關係檢視$/.test(userText)) {
        await client.replyMessage(event.replyToken, { type: 'text', text: AI_RELATIONSHIP });
        return;
      }
      if (/^(7天|７天)$/.test(userText)) {
        store.start(userId);
        await client.replyMessage(event.replyToken, { type: 'text', text: '好，我們開始 7 天練習信——' });
        await pushDay(userId, 1);
        return;
      }
      // 一般對話 → 交給 AI 依珊（含危機硬性攔截）
      const history = store.getChat(userId);
      const { text: reply, crisis } = await ai.generateReply(userText, history);
      store.pushChat(userId, 'user', userText);
      store.pushChat(userId, 'assistant', reply);
      if (crisis) store.requestHuman(userId, true);
      await client.replyMessage(event.replyToken, { type: 'text', text: reply });
      return;
    }

    // (d) 非 AI 模式：7 天信起始
    if (/^(7天|７天|開始|start)$/i.test(userText)) {
      store.start(userId);
      await client.replyMessage(event.replyToken, { type: 'text', text: '好，我們開始。這是今天的第一封信——' });
      await pushDay(userId, 1);
      return;
    }
    // (e) 其他訊息：溫柔提示，並引導找依珊
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '我在。想找人說說話、整理心情，回覆「找依珊」，我會陪妳。\n想（重新）開始 7 天練習信，回覆「7天」就可以。'
    });
    return;
  }

  // 3) 選擇題作答（postback）→ 回對應的陪伴句
  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback.data);
    // 圖文選單「找依珊」按鈕：data 設為 action=find_yishan
    if (params.get('action') === 'find_yishan') {
      await enterAiMode(userId, event.replyToken);
      return;
    }
    const dayNum = Number(params.get('day'));
    const optKey = params.get('opt');
    const d = letters[dayNum];
    const opt = d && d.quiz.options.find(o => o.key === optKey);
    if (opt) {
      await client.replyMessage(event.replyToken, { type: 'text', text: opt.reply });
    }
    return;
  }
}

// ---------- 每日推播邏輯（給排程與外部觸發共用）----------
async function runDailyPush() {
  const today = store.todayStr();
  let sent = 0;
  for (const u of store.list()) {
    if (u.day >= TOTAL_DAYS) continue;      // 已完成 7 天
    if (u.lastPushDate === today) continue; // 今天已推過，避免重複
    const next = u.day + 1;
    try {
      await pushDay(u.userId, next);
      store.update(u.userId, { day: next, lastPushDate: today });
      sent++;
      console.log(`pushed Day${next} -> ${u.userId}`);
    } catch (e) {
      console.error('push fail', u.userId, e.message);
    }
  }
  return sent;
}

// 內建排程：早上 07:30（台北）。若主機一直清醒，這個就會運作。
cron.schedule('30 7 * * *', runDailyPush, { timezone: 'Asia/Taipei' });

// 外部排程觸發用（免費主機會休眠時，用 cron-job.org 之類每天 07:30 打這個網址喚醒並發信）
// 例：GET https://你的網址/cron/daily?key=你的CRON_SECRET
app.get('/cron/daily', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.key !== process.env.CRON_SECRET) {
    return res.status(401).send('unauthorized');
  }
  const sent = await runDailyPush();
  res.send(`ok, pushed ${sent}`);
});

// ---------- 測試用：手動推某一天給某人（上線後可移除或加保護）----------
app.get('/test-push', async (req, res) => {
  const { to, day } = req.query;
  if (!to || !day) return res.status(400).send('need ?to=USERID&day=1');
  try { await pushDay(to, Number(day)); res.send('ok'); }
  catch (e) { res.status(500).send(e.message); }
});

app.get('/', (_, res) => res.send('覺醒代碼 LINE 7天信 bot is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on :${PORT}`));
