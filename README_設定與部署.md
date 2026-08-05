# 覺醒代碼《7天・把自己帶回來》LINE 自動化程式

這個程式讓妳的 LINE 官方帳號：**加好友（或傳「7天」）就開始 → 每天早晨自動寄一封信 → 使用者點選擇題按鈕就收到專屬陪伴回覆**。

---

## 一、它會做什麼

- 有人加妳的 LINE 好友，馬上收到歡迎訊息 + Day 1 的信。
- 之後每天早上 07:30（台灣時間）自動推播 Day 2～7。
- 每封信最後有一排選項按鈕（A、B、C…），使用者點一下，立刻收到那個選項對應的一句陪伴（內容我已全部寫在 `letters.js`）。
- 全程一對一、只有妳和對方看得到。

## 二、你需要準備（約 20 分鐘）

### 1. 把 LINE 官方帳號開通「Messaging API」
> 這一步是把「一般官方帳號」升級成可以接程式的版本，免費。

1. 到 **LINE Developers**：https://developers.line.biz/ ，用妳的 LINE 登入。
2. 建立一個 **Provider**（隨意命名，例如「覺醒代碼」）。
3. 在裡面建立一個 **Messaging API channel**，綁定妳現有的官方帳號 `@011ajtta`（或在 LINE Official Account Manager → 設定 → Messaging API 啟用，兩邊會連動）。
4. 記下兩個金鑰：
   - **Channel secret**（Basic settings 頁）
   - **Channel access token**（Messaging API 頁，按「Issue」產生長期 token）

### 2. 關掉會打架的內建自動回應
在 **LINE Official Account Manager → 回應設定**：
- 「Webhook」：**開啟**
- 「自動回應訊息」：**關閉**（不然會和程式重複回）
- 「加入好友的歡迎訊息」：可關閉（程式已內建歡迎訊息）

## 三、把程式跑起來（選一個平台）

程式需要 24 小時在線的主機。最簡單的免費/低成本選擇：**Render**（也可用 Railway、Fly.io、自己的 VPS）。

### 用 Render 部署（範例）
1. 把這個資料夾放到一個 GitHub repo（或直接上傳）。
2. 到 https://render.com → New → **Web Service** → 連到這個 repo。
3. 設定：
   - Build Command：`npm install`
   - Start Command：`npm start`
4. 在 **Environment** 加入兩個變數：
   - `LINE_CHANNEL_ACCESS_TOKEN` = 你的 access token
   - `LINE_CHANNEL_SECRET` = 你的 channel secret
5. 部署完成後會得到一個網址，例如 `https://juexingli-line.onrender.com`。
6. 回到 **LINE Developers → Messaging API → Webhook URL**，填：
   `https://juexingli-line.onrender.com/callback`
   按「Verify」出現成功即可。

### 在自己電腦先測試（可選）
```bash
npm install
cp .env.example .env      # 然後把 .env 裡的兩個金鑰填好
npm start
```
本機測試 webhook 需要用 ngrok 之類把 localhost 對外，再把該網址 + `/callback` 填到 Webhook URL。

## 四、測試流程
1. 手機加自己的官方帳號好友 → 應收到歡迎訊息 + Day 1。
2. 點 Day 1 的選項按鈕 → 應立刻收到那個選項的陪伴句。
3. 想測隔天的信不用等：瀏覽器開
   `https://你的網址/test-push?to=你的userId&day=2`
   （userId 可在後台 log 或 webhook 事件看到；上線後建議把這個測試路徑移除或加密。）

## 五、要改內容時
所有信件文字、選項、陪伴回覆，都集中在 **`letters.js`**，照著現有格式改字就好，不用動 `server.js`。

## 六、內容檔案
- `server.js`　主程式（webhook + 每日排程 + 選擇題回覆）
- `letters.js`　7 天的信件內容與每個選項的陪伴回覆
- `store.js`　訂閱者進度存放（subscribers.json，會自動產生）
- `package.json`／`.env.example`

---

## 七、如果暫時不想架程式：LINE 內建的「無程式」做法
妳也可以先不寫程式，用 LINE 官方帳號後台內建功能達到八成效果：

- **逐步訊息（Step message）**：建立一組 7 天的漸進式訊息，觸發＝加好友；Day 1–7 每天早上自動推。
- **快速回覆（Quick reply）**：每天最後一則附上選項按鈕。
- **自動回應（關鍵字）**：把每個選項代號（如「A 下巴緊」）設成關鍵字，對應一句陪伴回覆。

缺點是關鍵字是全域的（不分第幾天），若不同天有相同代號會打架；要做到「同一個 A 在不同天回不同話」，就需要這支程式。內容我在 `letters.js` 都寫好了，兩種做法都能直接取用。

> 安全提醒：這是陪伴與自我照顧的內容，不是心理諮商或治療。若對方訊息顯示可能有危機，請以真人關心並協助尋求專業資源為優先。
