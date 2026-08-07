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
  // 把選項用數字列在訊息裡（符合「1 肩頸緊　2 背痛…」的樣式），同時附上可點的快速回覆按鈕
  const list = d.quiz.options.map(o => o.label).join('　');
  msgs.push({
    type: 'text',
    text: `${d.quiz.question}\n${list}\n\n回覆最接近的代號就好，或直接打字告訴我。`,
    quickReply: { items }
  });

  // 一句帶走 + 固定收尾（＋醫療提醒）
  let tail = `✦ 一句帶走\n${d.takeaway}\n\n${d.closing}`;
  if (d.medical) tail += `\n\n${d.medical}`;
  msgs.push({ type: 'text', text: tail });

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

  // 1) 加好友 → 由 LINE 內建「加入好友的歡迎訊息」負責問候；
  //    這裡不重複發訊息，使用者回覆「開始」才啟動 7 天信（見下方）。
  if (event.type === 'follow') {
    return;
  }

  // 2) 文字訊息
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();
    if (/^(7天|７天|開始|start)$/i.test(text)) {
      store.start(userId);
      await client.replyMessage(event.replyToken, { type: 'text', text: '好，我們開始。這是今天的第一封信——' });
      await pushDay(userId, 1);
      return;
    }
    // 其他文字：交給 LINE 內建的關鍵字／通用回覆處理，機器人不重複回覆。
    return;
  }

  // 3) 選擇題作答（postback）→ 回對應的陪伴句
  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback.data);
    const dayNum = Number(params.get('day'));
    const optKey = params.get('opt');
    const d = letters[dayNum];
    const opt = d && d.quiz.options.find(o => o.key === optKey);
    if (opt) {
      // 先回這個選項專屬的陪伴，再送一段有溫度的支持訊息
      const replies = [{ type: 'text', text: opt.reply }];
      if (d.support) replies.push({ type: 'text', text: d.support });
      await client.replyMessage(event.replyToken, replies);
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

// 內建排程：晚上 20:40（台北）。若主機一直清醒，這個就會運作。
cron.schedule('40 20 * * *', runDailyPush, { timezone: 'Asia/Taipei' });

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
