// ===== 1. API KEY & MODEL CONFIG =====
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const GEMINI_SYSTEM_INSTRUCTION =
  'You are J.A.R.V.I.S, a friendly personal assistant for Vamshi. Reply naturally in a warm Telugu-English mix, using clear concise language. If you do not know, say so plainly.';

let API_KEY = (localStorage.getItem('jarvis_key') || '').trim();
if (!API_KEY) {
  const entered = prompt('Enter your Gemini API Key:');
  if (entered && entered.trim()) {
    API_KEY = entered.trim();
    localStorage.setItem('jarvis_key', API_KEY);
  }
} else {
  localStorage.setItem('jarvis_key', API_KEY);
}

function promptForNewApiKey() {
  const entered = prompt('Enter or update your Gemini API Key:', API_KEY || '');
  if (entered && entered.trim()) {
    API_KEY = entered.trim();
    localStorage.setItem('jarvis_key', API_KEY);
    return true;
  }
  return false;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts
      .map(p => (typeof p?.text === 'string' ? p.text : ''))
      .join('\n')
      .trim();
    if (text) return text;
  }
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  return '';
}

async function callGeminiModel(model, contents, systemInstruction = GEMINI_SYSTEM_INSTRUCTION, timeoutMs = 20000) {
  const cleanKey = (API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('Gemini API key is missing. Reload the page and enter it again.');
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  const payload = {
    contents,
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {})
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cleanKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {})
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      const msg = data?.error?.message || `Gemini request failed (${response.status}).`;
      const err = new Error(msg);
      err.status = response.status;
      throw err;
    }

    const reply = extractGeminiText(data);
    if (!reply) {
      throw new Error('Gemini returned an empty response.');
    }
    return reply;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function requestGeminiReply(userText, imagePart = null, onStatus = null) {
  const historySlice = MEMORY.slice(-16).map(m => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: m.text }]
  }));

  const currentParts = [];
  if (userText && userText.trim()) {
    currentParts.push({ text: userText.trim() });
  }
  if (imagePart) {
    currentParts.push(imagePart);
  }
  if (!currentParts.length) {
    currentParts.push({ text: 'Analyze this image and explain clearly.' });
  }

  const contents = [...historySlice, { role: 'user', parts: currentParts }];

  let lastError = null;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    try {
      return await callGeminiModel(model, contents, GEMINI_SYSTEM_INSTRUCTION);
    } catch (err) {
      lastError = err;
      // Don't retry fallback if the API key itself is invalid
      if (err?.status === 400 || err?.status === 401 || err?.status === 403) {
        if (/api key/i.test(err.message)) throw err;
      }
      if (i < GEMINI_MODELS.length - 1 && typeof onStatus === 'function') {
        onStatus('Gemini busy undi; backup model try chesthunna...');
      }
    }
  }
  throw lastError || new Error('Unable to reach Gemini.');
}

// ===== 2. MEMORY & UI REFERENCES =====
let MEMORY = [];
try {
  const storedMemory = JSON.parse(localStorage.getItem('jarvis_memory') || '[]');
  if (Array.isArray(storedMemory)) {
    MEMORY = storedMemory.filter(
      m =>
        m &&
        (m.role === 'user' || m.role === 'model') &&
        typeof m.text === 'string' &&
        !(m.role === 'model' && /^(?:Your strong password:|ఇదిగో strong password:)/i.test(m.text))
    );
    if (MEMORY.length !== storedMemory.length) {
      localStorage.setItem('jarvis_memory', JSON.stringify(MEMORY));
    }
  } else {
    localStorage.removeItem('jarvis_memory');
  }
} catch (e) {
  localStorage.removeItem('jarvis_memory');
}

const chat = document.getElementById('chat');
const conversationStage = document.getElementById('conversation-stage');
const input = document.getElementById('msg');
const sendBtn = document.getElementById('send');
const micBtn = document.getElementById('mic-btn');
const wakeBtn = document.getElementById('wake-btn');
const wakeStatus = document.getElementById('wake-status');
const clearBtn = document.getElementById('clear-btn');
const newChatBtn = document.getElementById('new-chat');
const camBtn = document.getElementById('cam-btn');
const imgInput = document.getElementById('img-input');
const historyList = document.getElementById('history-list');
const historyCount = document.getElementById('history-count');
const menuButton = document.getElementById('menu-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const settingsOpen = document.getElementById('settings-open');
const settingsClose = document.getElementById('settings-close');
const settingsPanel = document.getElementById('settings-panel');
const settingsScrim = document.getElementById('settings-scrim');
const themeSelect = document.getElementById('theme-select');
const clearMemorySetting = document.getElementById('clear-memory-setting');
const thinkingStatus = document.getElementById('thinking-status');
const thinkingLabel = document.getElementById('thinking-label');

const HISTORY_KEY = 'jarvis_conversation_history_v1';
const ACTIVE_CONVERSATION_KEY = 'jarvis_active_conversation_v1';
let CONVERSATIONS = [];

try {
  const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (Array.isArray(stored)) {
    CONVERSATIONS = stored
      .filter(c => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map(c => ({
        ...c,
        messages: c.messages.filter(m => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
      }));
  }
} catch (e) {
  localStorage.removeItem(HISTORY_KEY);
}

function makeConversationId() {
  return 'chat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function conversationTitle(messages) {
  const first = (messages || []).find(m => m && m.role === 'user' && typeof m.text === 'string');
  return first ? first.text.replace(/\s+/g, ' ').trim().slice(0, 42) || 'New chat' : 'New chat';
}

let ACTIVE_CONVERSATION_ID = localStorage.getItem(ACTIVE_CONVERSATION_KEY) || '';
let initialConversation = CONVERSATIONS.find(c => c.id === ACTIVE_CONVERSATION_ID);
if (!initialConversation) {
  initialConversation = {
    id: makeConversationId(),
    title: conversationTitle(MEMORY),
    updatedAt: Date.now(),
    messages: MEMORY.slice(-120)
  };
  CONVERSATIONS.unshift(initialConversation);
  ACTIVE_CONVERSATION_ID = initialConversation.id;
} else {
  MEMORY = initialConversation.messages.length ? initialConversation.messages.slice(-120) : MEMORY.slice(-120);
  initialConversation.messages = MEMORY.slice(-120);
  initialConversation.title = conversationTitle(MEMORY) || initialConversation.title || 'New chat';
}
localStorage.setItem('jarvis_memory', JSON.stringify(MEMORY));
localStorage.setItem(ACTIVE_CONVERSATION_KEY, ACTIVE_CONVERSATION_ID);

function currentConversation() {
  return CONVERSATIONS.find(c => c.id === ACTIVE_CONVERSATION_ID);
}

function saveMemory() {
  localStorage.setItem('jarvis_memory', JSON.stringify(MEMORY));
  const current = currentConversation();
  if (current) {
    current.messages = MEMORY.slice(-120);
    current.updatedAt = Date.now();
    current.title = conversationTitle(current.messages) || current.title || 'New chat';
    CONVERSATIONS.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    CONVERSATIONS = CONVERSATIONS.slice(0, 30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(CONVERSATIONS));
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, ACTIVE_CONVERSATION_ID);
    renderHistoryList();
  }
}

function add(text, role = 'ai') {
  if (!chat) return null;
  document.body.classList.add('has-conversation');
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
  div.innerText = text;
  chat.appendChild(div);
  scrollConversationToBottom();
  return div;
}

function renderHistoryList() {
  if (!historyList) return;
  const visible = CONVERSATIONS.filter(c => c.messages && c.messages.length).sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );
  if (historyCount) historyCount.textContent = visible.length ? String(visible.length) : '';
  historyList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Your conversations will appear here';
    historyList.appendChild(empty);
    return;
  }

  visible.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.dataset.conversationId = item.id;
    button.setAttribute('aria-current', String(item.id === ACTIVE_CONVERSATION_ID));

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5zM5 5.5v15M9 7h6M9 10h7');
    icon.appendChild(path);

    const label = document.createElement('span');
    label.className = 'history-item-label';
    label.textContent = item.title || conversationTitle(item.messages);

    button.append(icon, label);
    button.addEventListener('click', () => switchConversation(item.id));
    historyList.appendChild(button);
  });
}

function setThinking(active, message) {
  const on = Boolean(active);
  if (on && thinkingLabel) thinkingLabel.textContent = message || 'J.A.R.V.I.S is thinking';
  document.body.classList.toggle('is-thinking', on);
  if (thinkingStatus) thinkingStatus.hidden = !on;
}

function scrollConversationToBottom() {
  if (!chat) return;
  const scroll = () => {
    chat.scrollTop = chat.scrollHeight;
  };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(scroll);
  else setTimeout(scroll, 16);
}

function setReply(node, text) {
  if (!node) return;
  node.innerText = text;
  scrollConversationToBottom();
}

function closeSidebarOnMobile() {
  if (window.matchMedia('(max-width: 780px)').matches) {
    document.body.classList.remove('sidebar-open');
    if (sidebarBackdrop) sidebarBackdrop.hidden = true;
  }
}

function toggleSidebar() {
  if (window.matchMedia('(max-width: 780px)').matches) {
    const open = !document.body.classList.contains('sidebar-open');
    document.body.classList.toggle('sidebar-open', open);
    if (sidebarBackdrop) sidebarBackdrop.hidden = !open;
  } else {
    document.body.classList.toggle('sidebar-collapsed');
  }
}

function switchConversation(id) {
  if (id === ACTIVE_CONVERSATION_ID) {
    closeSidebarOnMobile();
    return;
  }
  const next = CONVERSATIONS.find(c => c.id === id);
  if (!next) return;
  const current = currentConversation();
  if (current) {
    current.messages = MEMORY.slice(-120);
    current.updatedAt = Date.now();
  }
  ACTIVE_CONVERSATION_ID = id;
  MEMORY = next.messages.slice(-120);
  localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
  localStorage.setItem('jarvis_memory', JSON.stringify(MEMORY));
  chat.replaceChildren();
  MEMORY.forEach(m =>
    add((m.role === 'user' ? 'YOU: ' : 'J.A.R.V.I.S: ') + m.text, m.role === 'user' ? 'user' : 'ai')
  );
  document.body.classList.toggle('has-conversation', MEMORY.length > 0);
  renderHistoryList();
  scrollConversationToBottom();
  closeSidebarOnMobile();
}

function startNewConversation() {
  if (!MEMORY.length) {
    input?.focus();
    closeSidebarOnMobile();
    return;
  }
  const current = currentConversation();
  if (current) {
    current.messages = MEMORY.slice(-120);
    current.updatedAt = Date.now();
  }
  const fresh = { id: makeConversationId(), title: 'New chat', updatedAt: Date.now(), messages: [] };
  CONVERSATIONS.unshift(fresh);
  CONVERSATIONS = CONVERSATIONS.slice(0, 30);
  ACTIVE_CONVERSATION_ID = fresh.id;
  MEMORY = [];
  localStorage.setItem('jarvis_memory', '[]');
  localStorage.setItem(ACTIVE_CONVERSATION_KEY, ACTIVE_CONVERSATION_ID);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(CONVERSATIONS));
  chat.replaceChildren();
  document.body.classList.remove('has-conversation');
  chat.scrollTop = 0;
  if (conversationStage) conversationStage.scrollTop = 0;
  renderHistoryList();
  if (input) {
    input.value = '';
    input.style.height = 'auto';
    input.focus();
  }
}

function clearCurrentConversation() {
  MEMORY = [];
  const current = currentConversation();
  if (current) {
    current.messages = [];
    current.title = 'New chat';
    current.updatedAt = Date.now();
  }
  localStorage.setItem('jarvis_memory', '[]');
  localStorage.setItem(HISTORY_KEY, JSON.stringify(CONVERSATIONS));
  chat.replaceChildren();
  document.body.classList.remove('has-conversation');
  renderHistoryList();
}

function openSettings() {
  if (settingsPanel) settingsPanel.hidden = false;
  if (settingsScrim) settingsScrim.hidden = false;
  closeSidebarOnMobile();
  settingsClose?.focus();
}

function closeSettings() {
  if (settingsPanel) settingsPanel.hidden = true;
  if (settingsScrim) settingsScrim.hidden = true;
  if (window.matchMedia('(max-width: 780px)').matches && !document.body.classList.contains('sidebar-open')) {
    menuButton?.focus();
  }
}

function applyTheme(theme) {
  const chosen = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = chosen;
  localStorage.setItem('jarvis_theme', chosen);
  if (themeSelect) themeSelect.value = chosen;
}

renderHistoryList();
applyTheme(localStorage.getItem('jarvis_theme') || 'dark');
MEMORY.forEach(m =>
  add((m.role === 'user' ? 'YOU: ' : 'J.A.R.V.I.S: ') + m.text, m.role === 'user' ? 'user' : 'ai')
);

// ===== 3. TOOLS (THE HANDS) =====
async function fetchToolJson(url, options = {}, timeoutMs = 10000) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
    if (!response.ok) throw new Error('Request failed (' + response.status + ').');
    return await response.json();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function handleTools(text) {
  const t = text.toLowerCase();

  if (/^\s*(?:please\s+)?(?:open\s+youtube|youtube\s+open|youtube)(?:\s+please)?[.!?]*\s*$/i.test(text)) {
    window.open('https://youtube.com', '_blank', 'noopener,noreferrer');
    return 'Opening YouTube, Boss.';
  }
  if (/^\s*(?:please\s+)?(?:open\s+google|google\s+open|google)(?:\s+please)?[.!?]*\s*$/i.test(text)) {
    window.open('https://google.com', '_blank', 'noopener,noreferrer');
    return 'Opening Google, Boss.';
  }

  const urlCommand = text.match(/^\s*(?:open|visit|go to)\s+(https?:\/\/\S+)\s*$/i);
  if (urlCommand) {
    try {
      const destination = new URL(urlCommand[1]);
      if (destination.protocol !== 'https:' && destination.protocol !== 'http:') {
        return 'Only http and https links can be opened.';
      }
      window.open(destination.href, '_blank', 'noopener,noreferrer');
      return 'Opening ' + destination.hostname + ', Boss.';
    } catch (e) {
      return 'That link does not look valid.';
    }
  }

  if (/^\s*(?:google\s+search|search\s+(?:on\s+)?google)(?:\s+for)?\s*$/i.test(text)) {
    return 'Tell me what to search for on Google.';
  }
  const googleSearch = text.match(/^\s*(?:google\s+search|search\s+(?:on\s+)?google)(?:\s+for)?\s+(.+?)\s*$/i);
  if (googleSearch) {
    const query = googleSearch[1].trim();
    if (!query) return 'Tell me what to search for on Google.';
    window.open('https://www.google.com/search?q=' + encodeURIComponent(query), '_blank', 'noopener,noreferrer');
    return 'Searching Google for ' + query + ', Boss.';
  }

  if (/^\s*(?:play|youtube\s+search|search\s+(?:on\s+)?youtube)(?:\s+for)?\s*$/i.test(text)) {
    return 'Tell me a song or search phrase for YouTube.';
  }
  const playMatch = text.match(/^\s*play\s+(.+?)\s*$/i);
  const youtubeMatch = text.match(/^\s*youtube(?:\s+search)?(?:\s+for)?\s+(.+?)\s*$/i);
  const searchYoutubeMatch = text.match(/^\s*search\s+(?:on\s+)?youtube(?:\s+for)?\s+(.+?)\s*$/i);
  const videoQuery = (playMatch || youtubeMatch || searchYoutubeMatch)?.[1]?.trim();
  if (videoQuery) {
    window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(videoQuery), '_blank', 'noopener,noreferrer');
    return 'Searching YouTube for ' + videoQuery + ', Boss.';
  }

  if (/^\s*(?:search|look up)(?:\s+for)?\s*$/i.test(text)) return 'Tell me what to search for.';
  const searchMatch = text.match(/^\s*(?:search|look up)\s+(?:for\s+)?(.+?)\s*$/i);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    if (!query) return 'Tell me what to search for.';
    try {
      const url =
        'https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&srsearch=' +
        encodeURIComponent(query) +
        '&format=json&origin=*';
      const data = await fetchToolJson(url);
      const result = data?.query?.search?.[0];
      if (!result) return 'I could not find that, Boss.';
      const snippet = String(result.snippet || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      return 'Wikipedia summary: ' + result.title + (snippet ? '. ' + snippet : '');
    } catch (e) {
      return 'Search error, Boss.';
    }
  }

  if (
    /\b(?:what time(?: is it)?|what is the time|current time|tell me the time|time now)\b/.test(t) ||
    /^\s*time(?:\s+please)?[.!?]*\s*$/.test(t) ||
    t.includes('టైమ్') ||
    t.includes('సమయం') ||
    t.includes('samayam')
  ) {
    return (
      'The time is ' +
      new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) +
      ' IST, Boss.'
    );
  }

  if (t.includes('weather') || t.includes('వాతావరణం')) {
    if (!navigator.geolocation) return 'I need location permission for weather, Boss.';
    return await new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        async position => {
          try {
            const url =
              'https://api.open-meteo.com/v1/forecast?latitude=' +
              position.coords.latitude +
              '&longitude=' +
              position.coords.longitude +
              '&current_weather=true';
            const data = await fetchToolJson(url);
            const temperatureValue = data?.current_weather?.temperature ?? data?.current?.temperature_2m;
            const temperature = Number(temperatureValue);
            if (temperatureValue === null || temperatureValue === undefined || !Number.isFinite(temperature)) {
              throw new Error('Weather data unavailable.');
            }
            resolve('It is ' + temperature + ' degrees Celsius now, Boss.');
          } catch (e) {
            resolve('Weather service error, Boss.');
          }
        },
        () => resolve('I need location permission for weather, Boss.'),
        { timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  const timerCommand = t.includes('timer') || t.includes('టైమర్');
  if (timerCommand) {
    const m = t.match(
      /(-?\d+(?:\.\d+)?)\s*(seconds?|secs?|sec|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|నిమిషం|నిమిషాలు|సెకను|సెకన్లు|గంట|గంటలు)/i
    );
    if (!m) return 'Timer format: say “timer 5 minutes”.';
    const amount = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) return 'Timer duration must be greater than zero.';
    const factor = /^(?:h|hr|hrs|hour|hours|గంట|గంటలు)/.test(unit)
      ? 3600000
      : /^(?:s|sec|secs|second|seconds|సెకను|సెకన్లు)/.test(unit)
      ? 1000
      : 60000;
    const duration = amount * factor;
    if (duration > 86400000) return 'Timer limit is 24 hours.';
    setTimeout(() => speakWithWakePause('టైమర్ పూర్తైంది! ' + amount + ' ' + unit + ' అయ్యాయి.'), duration);
    return 'Timer set for ' + amount + ' ' + unit + '.';
  }

  if (/\bdice\b/.test(t)) return 'You rolled ' + (Math.floor(Math.random() * 6) + 1) + ', Boss.';
  if (/\bcoin\b/.test(t)) return Math.random() < 0.5 ? 'Heads, Boss.' : 'Tails, Boss.';

  if (/\bjoke\b/.test(t)) {
    try {
      const data = await fetchToolJson('https://official-joke-api.appspot.com/random_joke');
      if (typeof data?.setup !== 'string' || typeof data?.punchline !== 'string') {
        throw new Error('Invalid joke response.');
      }
      return data.setup + ' ... ' + data.punchline;
    } catch (e) {
      try {
        const backup = await fetchToolJson('https://v2.jokeapi.dev/joke/Any?type=twopart&safe-mode');
        if (
          !backup?.error &&
          backup?.type === 'twopart' &&
          typeof backup.setup === 'string' &&
          typeof backup.delivery === 'string'
        ) {
          return backup.setup + ' ... ' + backup.delivery;
        }
      } catch (x) {}
      const fallback = [
        ['Why did the computer go to the doctor?', 'It had a virus.'],
        ['Why was the math book sad?', 'It had too many problems.']
      ];
      const joke = fallback[Math.floor(Math.random() * fallback.length)];
      return joke[0] + ' ... ' + joke[1];
    }
  }

  if (t.includes('quote') || t.includes('motivate')) {
    try {
      const data = await fetchToolJson('https://dummyjson.com/quotes/random');
      if (typeof data?.quote !== 'string' || typeof data?.author !== 'string') {
        throw new Error('Invalid quote response.');
      }
      return data.quote + ' — by ' + data.author;
    } catch (e) {
      return 'A small step today is still progress. — by J.A.R.V.I.S';
    }
  }

  if (/\bnews\b/.test(t)) {
    try {
      const ids = await fetchToolJson('https://hacker-news.firebaseio.com/v0/topstories.json');
      if (!Array.isArray(ids) || !ids.length) throw new Error('No stories.');
      const top = await Promise.all(
        ids.slice(0, 3).map(id => fetchToolJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
      );
      const headlines = top
        .filter(item => item && item.title)
        .map((item, idx) => `${idx + 1}. ${item.title}`)
        .join('\n');
      return headlines ? 'Top tech headlines, Boss:\n' + headlines : 'Could not fetch news right now, Boss.';
    } catch (e) {
      return 'News service is unreachable right now, Boss.';
    }
  }

  if (/\b(?:bitcoin|btc)\b/.test(t)) {
    try {
      const data = await fetchToolJson(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,inr'
      );
      const usd = data?.bitcoin?.usd;
      const inr = data?.bitcoin?.inr;
      if (typeof usd === 'number') {
        const inrText = typeof inr === 'number' ? ` (₹${inr.toLocaleString('en-IN')})` : '';
        return `Bitcoin is currently $${usd.toLocaleString('en-US')}${inrText}, Boss.`;
      }
    } catch (e) {}
  }

  const translateMatch = text.match(/^\s*translate\s+(.+?)\s+(?:to|into)\s+([a-zA-Z\s]+)\s*$/i);
  if (translateMatch) {
    const phrase = translateMatch[1].trim();
    const targetLang = translateMatch[2].trim();
    return await requestGeminiReply(
      `Translate "${phrase}" into ${targetLang}. Give only the natural translation and pronunciation if helpful.`
    );
  }

  if (/^\s*(?:api\s*key|set\s*key|change\s*key|reset\s*key)\s*$/i.test(text)) {
    const updated = promptForNewApiKey();
    return updated ? 'Gemini API key updated, Boss.' : 'API key unchanged, Boss.';
  }

  return null;
}

// ===== 4. VOICE & WAKE WORD LOOP =====
let WAKE_ENABLED = false;
let IS_SPEAKING = false;
let wakeRecognition = null;
let commandRecognition = null;

function speakWithWakePause(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const clean = String(text)
      .replace(/^J\.A\.R\.V\.I\.S:\s*/i, '')
      .replace(/[*#_`]/g, '')
      .trim();
    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = /[\u0C00-\u0C7F]/.test(clean) ? 'te-IN' : 'en-IN';
    utterance.rate = 1.02;

    utterance.onstart = () => {
      IS_SPEAKING = true;
      if (wakeRecognition) {
        try {
          wakeRecognition.stop();
        } catch (e) {}
      }
    };
    utterance.onend = utterance.onerror = () => {
      IS_SPEAKING = false;
      if (WAKE_ENABLED) {
        setTimeout(startWakeLoop, 350);
      }
    };

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    IS_SPEAKING = false;
  }
}

function updateWakeUI() {
  if (wakeStatus) {
    wakeStatus.textContent = WAKE_ENABLED ? 'WAKE: ON' : 'WAKE: OFF';
    wakeStatus.style.color = WAKE_ENABLED ? '#70d9b0' : '#888';
  }
  if (wakeBtn) {
    wakeBtn.style.color = WAKE_ENABLED ? '#70d9b0' : '';
  }
}

function startWakeLoop() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec || !WAKE_ENABLED || IS_SPEAKING) return;

  try {
    if (wakeRecognition) {
      try {
        wakeRecognition.stop();
      } catch (e) {}
    }
    wakeRecognition = new SpeechRec();
    wakeRecognition.lang = 'en-IN';
    wakeRecognition.continuous = false;
    wakeRecognition.interimResults = false;

    wakeRecognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      const lower = transcript.toLowerCase().trim();
      if (/\b(?:hey\s+jarvis|hi\s+jarvis|hello\s+jarvis|jarvis)\b/.test(lower)) {
        const afterWake = lower.replace(/^.*?\b(?:hey\s+jarvis|hi\s+jarvis|hello\s+jarvis|jarvis)\b[,.\s]*/i, '').trim();
        if (afterWake) {
          sendMessage(afterWake, { speak: true });
        } else {
          speakWithWakePause('Yes Boss, listening.');
          setTimeout(() => startSingleVoiceCommand(true), 900);
        }
      }
    };

    wakeRecognition.onend = () => {
      if (WAKE_ENABLED && !IS_SPEAKING) {
        setTimeout(startWakeLoop, 400);
      }
    };

    wakeRecognition.onerror = () => {
      if (WAKE_ENABLED && !IS_SPEAKING) {
        setTimeout(startWakeLoop, 1200);
      }
    };

    wakeRecognition.start();
  } catch (e) {}
}

function toggleWakeMode() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    add('J.A.R.V.I.S: Voice recognition is not supported in this browser.', 'ai');
    return;
  }
  WAKE_ENABLED = !WAKE_ENABLED;
  updateWakeUI();
  if (WAKE_ENABLED) {
    startWakeLoop();
  } else if (wakeRecognition) {
    try {
      wakeRecognition.stop();
    } catch (e) {}
  }
}

function startSingleVoiceCommand(speakReply = true) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    add('J.A.R.V.I.S: Voice input is not supported in this browser.', 'ai');
    return;
  }

  if (wakeRecognition) {
    try {
      wakeRecognition.stop();
    } catch (e) {}
  }

  try {
    if (commandRecognition) {
      try {
        commandRecognition.stop();
      } catch (e) {}
    }
    commandRecognition = new SpeechRec();
    commandRecognition.lang = 'en-IN';
    commandRecognition.interimResults = false;
    commandRecognition.maxAlternatives = 1;

    if (micBtn) micBtn.style.color = '#ff8c9a';

    commandRecognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript.trim()) {
        sendMessage(transcript.trim(), { speak: speakReply });
      }
    };

    commandRecognition.onend = commandRecognition.onerror = () => {
      if (micBtn) micBtn.style.color = '';
      if (WAKE_ENABLED && !IS_SPEAKING) {
        setTimeout(startWakeLoop, 400);
      }
    };

    commandRecognition.start();
  } catch (e) {
    if (micBtn) micBtn.style.color = '';
  }
}

// ===== 5. MAIN MESSAGE & VISION ROUTER =====
let IS_BUSY = false;

async function sendMessage(overrideText = null, options = {}) {
  if (IS_BUSY) return;
  const rawText = overrideText !== null ? String(overrideText) : input ? input.value : '';
  const text = rawText.trim();
  const imagePart = options.imagePart || null;

  if (!text && !imagePart) return;

  if (overrideText === null && input) {
    input.value = '';
    input.style.height = 'auto';
  }

  const displayUserText = text || '[Attached Image]';
  add('YOU: ' + displayUserText, 'user');
  MEMORY.push({ role: 'user', text: displayUserText });
  saveMemory();

  const replyNode = add('J.A.R.V.I.S: Thinking...', 'ai');
  setThinking(true, 'J.A.R.V.I.S is thinking');
  IS_BUSY = true;

  try {
    let reply = null;
    if (!imagePart && text) {
      reply = await handleTools(text);
    }
    if (!reply) {
      reply = await requestGeminiReply(text, imagePart, statusMsg => {
        setThinking(true, statusMsg);
        setReply(replyNode, 'J.A.R.V.I.S: ' + statusMsg);
      });
    }

    setReply(replyNode, 'J.A.R.V.I.S: ' + reply);
    MEMORY.push({ role: 'model', text: reply });
    saveMemory();

    if (options.speak) {
      speakWithWakePause(reply);
    }
  } catch (err) {
    const errMsg = err?.message || 'Unknown error';
    setReply(replyNode, 'J.A.R.V.I.S: ERROR - ' + errMsg);
  } finally {
    IS_BUSY = false;
    setThinking(false);
  }
}

function handleImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const commaIdx = result.indexOf(',');
    if (commaIdx === -1) return;
    const base64Data = result.slice(commaIdx + 1);
    const mimeType = file.type || 'image/jpeg';
    const promptText = input && input.value.trim() ? input.value.trim() : 'Analyze this image and describe what you see.';
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    sendMessage(promptText, {
      imagePart: {
        inlineData: {
          mimeType,
          data: base64Data
        }
      }
    });
  };
  reader.readAsDataURL(file);
}

// ===== 6. EVENT LISTENERS & ORB INIT =====
if (sendBtn) {
  sendBtn.addEventListener('click', () => sendMessage());
}

if (input) {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  });
}

document.querySelectorAll('.prompt-card[data-prompt]').forEach(card => {
  card.addEventListener('click', () => {
    const promptText = card.getAttribute('data-prompt');
    if (promptText) sendMessage(promptText);
  });
});

if (micBtn) micBtn.addEventListener('click', () => startSingleVoiceCommand(true));
if (wakeBtn) wakeBtn.addEventListener('click', toggleWakeMode);
if (clearBtn) clearBtn.addEventListener('click', clearCurrentConversation);
if (newChatBtn) newChatBtn.addEventListener('click', startNewConversation);
if (menuButton) menuButton.addEventListener('click', toggleSidebar);
if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebarOnMobile);
if (settingsOpen) settingsOpen.addEventListener('click', openSettings);
if (settingsClose) settingsClose.addEventListener('click', closeSettings);
if (settingsScrim) settingsScrim.addEventListener('click', closeSettings);
if (clearMemorySetting) {
  clearMemorySetting.addEventListener('click', () => {
    clearCurrentConversation();
    closeSettings();
  });
}
if (themeSelect) {
  themeSelect.addEventListener('change', e => applyTheme(e.target.value));
}
if (camBtn && imgInput) {
  camBtn.addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) handleImageFile(file);
    imgInput.value = '';
  });
}

// Initialize live cyan Orb if Orbs library loaded
window.addEventListener('DOMContentLoaded', () => {
  const orbContainer = document.getElementById('jarvis-core-container');
  if (orbContainer && typeof window.Orbs !== 'undefined') {
    try {
      new window.Orbs(orbContainer, {
        color: '#00ffff',
        size: 150
      });
    } catch (e) {}
  }
});
