// ===== 1. API KEY & MODEL CONFIG =====
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const USER_NAME = 'Boss';
const GEMINI_SYSTEM_INSTRUCTION =
  `You are J.A.R.V.I.S, a warm, sweet, and helpful personal AI assistant for ${USER_NAME}. ` +
  `Always address the user as ${USER_NAME} naturally. Reply primarily in Kannada (ಕನ್ನಡ script) or a gentle Kannada-English mix depending on how ${USER_NAME} speaks, keeping replies concise, polite, and easy to speak aloud. If you do not know something, say so plainly in Kannada.`;

let API_KEY = (localStorage.getItem('jarvis_key') || '').trim();
if (!API_KEY) {
  const entered = prompt(`Welcome ${USER_NAME}! Enter your Gemini API Key:`);
  if (entered && entered.trim()) {
    API_KEY = entered.trim();
    localStorage.setItem('jarvis_key', API_KEY);
  }
} else {
  localStorage.setItem('jarvis_key', API_KEY);
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
    currentParts.push({ text: 'ಈ ಚಿತ್ರವನ್ನು ವಿಶ್ಲೇಷಿಸಿ ಕನ್ನಡದಲ್ಲಿ ಸರಳವಾಗಿ ವಿವರಿಸಿ.' });
  }

  const contents = [...historySlice, { role: 'user', parts: currentParts }];

  let lastError = null;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    try {
      return await callGeminiModel(model, contents, GEMINI_SYSTEM_INSTRUCTION);
    } catch (err) {
      lastError = err;
      if (err?.status === 400 || err?.status === 401 || err?.status === 403) {
        if (/api key/i.test(err.message)) throw err;
      }
      if (i < GEMINI_MODELS.length - 1 && typeof onStatus === 'function') {
        onStatus('ಜಾರ್ವಿಸ್ ಬ್ಯಾಕಪ್ ಮಾಡೆಲ್ ಪ್ರಯತ್ನಿಸುತ್ತಿದೆ...');
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
      m => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string'
    );
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
const topbarSettingsBtn = document.getElementById('topbar-settings-btn');
const settingsClose = document.getElementById('settings-close');
const settingsPanel = document.getElementById('settings-panel');
const settingsScrim = document.getElementById('settings-scrim');
const themeSelect = document.getElementById('theme-select');
const voiceSelect = document.getElementById('voice-select');
const testVoiceBtn = document.getElementById('test-voice-btn');
const clearMemorySetting = document.getElementById('clear-memory-setting');
const thinkingStatus = document.getElementById('thinking-status');
const thinkingLabel = document.getElementById('thinking-label');

(function initOrb() {
  const container = document.getElementById('jarvis-core-container');
  if (container && window.Orbs) {
    try {
      new window.Orbs(container, {
        color: '#00ffff',
        secondaryColor: '#79c9ff',
        speed: 1.2
      });
    } catch (e) {}
  }
})();

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

// ===== 3. 20 DISTINCT VOICES ENGINE =====
const VOICE_KEY = 'jarvis_selected_voice_v2';
let AVAILABLE_VOICES = [];
let isSpeaking = false;

const VOICE_PRESETS = [
  { id: 'v01', label: '01. Sweet Girl (Kannada)',     voiceIdx: 0,  preferKn: true,  pitch: 1.32, rate: 0.98 },
  { id: 'v02', label: '02. Cute High Girl',           voiceIdx: 1,  preferKn: true,  pitch: 1.55, rate: 1.05 },
  { id: 'v03', label: '03. Soft Gentle Girl',         voiceIdx: 2,  preferKn: true,  pitch: 1.18, rate: 0.90 },
  { id: 'v04', label: '04. Indian Girl (Priya)',      voiceIdx: 3,  preferKn: false, pitch: 1.28, rate: 0.98 },
  { id: 'v05', label: '05. British Lady (Emma)',      voiceIdx: 4,  preferKn: false, pitch: 1.20, rate: 0.96 },
  { id: 'v06', label: '06. American Girl (Aria)',     voiceIdx: 5,  preferKn: false, pitch: 1.25, rate: 1.02 },
  { id: 'v07', label: '07. Cheerful Anime Girl',      voiceIdx: 6,  preferKn: false, pitch: 1.65, rate: 1.12 },
  { id: 'v08', label: '08. Calm Meditation Lady',     voiceIdx: 7,  preferKn: false, pitch: 1.05, rate: 0.82 },
  { id: 'v09', label: '09. Fast Smart Assistant',     voiceIdx: 8,  preferKn: false, pitch: 1.22, rate: 1.26 },
  { id: 'v10', label: '10. Royal Queen Voice',        voiceIdx: 9,  preferKn: false, pitch: 0.92, rate: 0.90 },
  { id: 'v11', label: '11. Classic Male J.A.R.V.I.S', voiceIdx: 10, preferKn: false, pitch: 0.85, rate: 0.98 },
  { id: 'v12', label: '12. Deep Bass Commander',      voiceIdx: 11, preferKn: false, pitch: 0.62, rate: 0.92 },
  { id: 'v13', label: '13. Friendly Young Guy',       voiceIdx: 12, preferKn: false, pitch: 1.02, rate: 1.04 },
  { id: 'v14', label: '14. Kannada Male Voice',       voiceIdx: 13, preferKn: true,  pitch: 0.72, rate: 0.95 },
  { id: 'v15', label: '15. Heavy Robot Titan',        voiceIdx: 14, preferKn: false, pitch: 0.55, rate: 0.86 },
  { id: 'v16', label: '16. Energetic Radio Host',     voiceIdx: 15, preferKn: false, pitch: 1.15, rate: 1.18 },
  { id: 'v17', label: '17. Storyteller Narrator',     voiceIdx: 16, preferKn: false, pitch: 0.95, rate: 0.84 },
  { id: 'v18', label: '18. Crystal Whisper',          voiceIdx: 17, preferKn: false, pitch: 1.42, rate: 0.92 },
  { id: 'v19', label: '19. News Anchor Pro',          voiceIdx: 18, preferKn: false, pitch: 0.98, rate: 1.08 },
  { id: 'v20', label: '20. Chipmunk / Playful AI',    voiceIdx: 19, preferKn: false, pitch: 1.75, rate: 1.15 }
];

let SELECTED_VOICE_ID = localStorage.getItem(VOICE_KEY) || 'v01';

function buildDistinctVoicePool() {
  if (!AVAILABLE_VOICES.length) return [];
  const knVoices = AVAILABLE_VOICES.filter(v => /^kn/i.test(v.lang));
  const inVoices = AVAILABLE_VOICES.filter(v => /-(IN|LK)\b/i.test(v.lang) && !/^kn/i.test(v.lang));
  const enVoices = AVAILABLE_VOICES.filter(v => /^en/i.test(v.lang) && !/-(IN|LK)\b/i.test(v.lang));
  const otherVoices = AVAILABLE_VOICES.filter(
    v => !/^kn/i.test(v.lang) && !/-(IN|LK)\b/i.test(v.lang) && !/^en/i.test(v.lang)
  );
  const seen = new Set();
  const ordered = [];
  [...knVoices, ...inVoices, ...enVoices, ...otherVoices].forEach(v => {
    if (!seen.has(v.voiceURI)) {
      seen.add(v.voiceURI);
      ordered.push(v);
    }
  });
  return ordered;
}

function populateVoiceSelector() {
  if (!voiceSelect) return;
  const prevValue = voiceSelect.value || SELECTED_VOICE_ID;
  voiceSelect.replaceChildren();
  const pool = buildDistinctVoicePool();

  VOICE_PRESETS.forEach((preset, idx) => {
    const opt = document.createElement('option');
    opt.value = preset.id;
    const mappedVoice = pool.length ? pool[idx % pool.length] : null;
    const engineTag = mappedVoice ? ` [${mappedVoice.lang}]` : '';
    opt.textContent = preset.label + engineTag;
    voiceSelect.appendChild(opt);
  });

  if (VOICE_PRESETS.some(v => v.id === prevValue)) {
    voiceSelect.value = prevValue;
    SELECTED_VOICE_ID = prevValue;
  } else {
    voiceSelect.value = 'v01';
    SELECTED_VOICE_ID = 'v01';
  }
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length) {
    AVAILABLE_VOICES = voices;
    populateVoiceSelector();
  }
}

populateVoiceSelector();
loadVoices();
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function resolveSystemVoiceForPreset(preset, hasKannadaScript) {
  if (!AVAILABLE_VOICES.length) loadVoices();
  const pool = buildDistinctVoicePool();
  if (!pool.length) return null;

  if (preset.preferKn && hasKannadaScript) {
    const knVoices = pool.filter(v => /^kn/i.test(v.lang));
    if (knVoices.length) {
      return knVoices[preset.voiceIdx % knVoices.length];
    }
  }
  return pool[preset.voiceIdx % pool.length];
}

function speakSweetly(rawText, onEndCallback = null) {
  if (!('speechSynthesis' in window)) {
    if (typeof onEndCallback === 'function') onEndCallback();
    return;
  }

  const cleanText = String(rawText || '')
    .replace(/^J\.A\.R\.V\.I\.S:\s*/i, '')
    .replace(/[*#_`~]/g, '')
    .trim();

  if (!cleanText) {
    if (typeof onEndCallback === 'function') onEndCallback();
    return;
  }

  window.speechSynthesis.cancel();

  const preset = VOICE_PRESETS.find(v => v.id === SELECTED_VOICE_ID) || VOICE_PRESETS[0];
  const hasKannada = /[\u0C80-\u0CFF]/.test(cleanText);
  const utterance = new SpeechSynthesisUtterance(cleanText);
  const chosenVoice = resolveSystemVoiceForPreset(preset, hasKannada);

  if (chosenVoice) {
    utterance.voice = chosenVoice;
    utterance.lang = chosenVoice.lang || (hasKannada ? 'kn-IN' : 'en-IN');
  } else {
    utterance.lang = hasKannada ? 'kn-IN' : 'en-IN';
  }

  utterance.pitch = preset.pitch;
  utterance.rate = preset.rate;
  utterance.volume = 1.0;

  isSpeaking = true;
  utterance.onend = () => {
    isSpeaking = false;
    if (typeof onEndCallback === 'function') onEndCallback();
  };
  utterance.onerror = () => {
    isSpeaking = false;
    if (typeof onEndCallback === 'function') onEndCallback();
  };

  window.speechSynthesis.speak(utterance);
}

// ===== 4. TOOLS (THE HANDS — KANNADA + ENGLISH) =====
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

  if (/^\s*(?:please\s+)?(?:open\s+youtube|youtube\s+open|youtube|ಯೂಟ್ಯೂಬ್\s*ತೆರೆ)(?:\s+please)?[.!?]*\s*$/i.test(text)) {
    window.open('https://youtube.com', '_blank', 'noopener,noreferrer');
    return `ಯೂಟ್ಯೂಬ್ ತೆರೆಯುತ್ತಿದ್ದೇನೆ, ${USER_NAME}.`;
  }
  if (/^\s*(?:please\s+)?(?:open\s+google|google\s+open|google|ಗೂಗಲ್\s*ತೆರೆ)(?:\s+please)?[.!?]*\s*$/i.test(text)) {
    window.open('https://google.com', '_blank', 'noopener,noreferrer');
    return `ಗೂಗಲ್ ತೆರೆಯುತ್ತಿದ್ದೇನೆ, ${USER_NAME}.`;
  }

  const urlCommand = text.match(/^\s*(?:open|visit|go to)\s+(https?:\/\/\S+)\s*$/i);
  if (urlCommand) {
    try {
      const destination = new URL(urlCommand[1]);
      if (destination.protocol !== 'https:' && destination.protocol !== 'http:') {
        return 'Only http and https links can be opened.';
      }
      window.open(destination.href, '_blank', 'noopener,noreferrer');
      return `Opening ${destination.hostname}, ${USER_NAME}.`;
    } catch (e) {
      return 'That link does not look valid.';
    }
  }

  const googleSearch = text.match(/^\s*(?:google\s+search|search\s+(?:on\s+)?google)(?:\s+for)?\s+(.+?)\s*$/i);
  if (googleSearch) {
    const query = googleSearch[1].trim();
    if (!query) return `ಏನು ಹುಡುಕಬೇಕು ಎಂದು ಹೇಳಿ, ${USER_NAME}.`;
    window.open('https://www.google.com/search?q=' + encodeURIComponent(query), '_blank', 'noopener,noreferrer');
    return `ಗೂಗಲ್‌ನಲ್ಲಿ ${query} ಹುಡುಕುತ್ತಿದ್ದೇನೆ, ${USER_NAME}.`;
  }

  const playMatch = text.match(/^\s*play\s+(.+?)\s*$/i);
  const youtubeMatch = text.match(/^\s*youtube(?:\s+search)?(?:\s+for)?\s+(.+?)\s*$/i);
  const searchYoutubeMatch = text.match(/^\s*search\s+(?:on\s+)?youtube(?:\s+for)?\s+(.+?)\s*$/i);
  const videoQuery = (playMatch || youtubeMatch || searchYoutubeMatch)?.[1]?.trim();
  if (videoQuery) {
    window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(videoQuery), '_blank', 'noopener,noreferrer');
    return `ಯೂಟ್ಯೂಬ್‌ನಲ್ಲಿ ${videoQuery} ಪ್ಲೇ ಮಾಡುತ್ತಿದ್ದೇನೆ, ${USER_NAME}.`;
  }

  const searchMatch = text.match(/^\s*(?:search|look up)\s+(?:for\s+)?(.+?)\s*$/i);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    if (!query) return `ಏನು ಹುಡುಕಬೇಕು ಎಂದು ತಿಳಿಸಿ, ${USER_NAME}.`;
    try {
      const url =
        'https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&srsearch=' +
        encodeURIComponent(query) +
        '&format=json&origin=*';
      const data = await fetchToolJson(url);
      const result = data?.query?.search?.[0];
      if (!result) return `ಕ್ಷಮಿಸಿ ${USER_NAME}, ಅದು ಸಿಗಲಿಲ್ಲ.`;
      const snippet = String(result.snippet || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      return `${result.title}: ${snippet}`;
    } catch (e) {
      return `ಹುಡುಕಾಟದಲ್ಲಿ ದೋಷವಾಗಿದೆ, ${USER_NAME}.`;
    }
  }

  if (
    /\b(?:what time(?: is it)?|what is the time|current time|tell me the time|time now)\b/.test(t) ||
    /^\s*time(?:\s+please)?[.!?]*\s*$/.test(t) ||
    t.includes('ಸಮಯ') ||
    t.includes('ಟೈಮ್') ||
    t.includes('samaya')
  ) {
    const nowTime = new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit'
    });
    return `${USER_NAME}, ಈಗ ಸಮಯ ${nowTime} IST ಆಗಿದೆ.`;
  }

  if (t.includes('weather') || t.includes('ಹವಾಮಾನ') || t.includes('havamaana')) {
    if (!navigator.geolocation) return `${USER_NAME}, ಹವಾಮಾನ ತಿಳಿಯಲು ಲೊಕೇಶನ್ ಅನುಮತಿ ಬೇಕು.`;
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
            const temp = data?.current_weather?.temperature ?? data?.current?.temperature_2m;
            if (temp !== undefined) {
              resolve(`${USER_NAME}, ನಿಮ್ಮ ಸ್ಥಳದಲ್ಲಿ ಈಗ ತಾಪಮಾನ ${temp}°C ಇದೆ.`);
            } else {
              resolve(`ಕ್ಷಮಿಸಿ ${USER_NAME}, ಹವಾಮಾನದ ಮಾಹಿತಿ ಸಿಗಲಿಲ್ಲ.`);
            }
          } catch (e) {
            resolve(`ಹವಾಮಾನ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ, ${USER_NAME}.`);
          }
        },
        () => resolve(`${USER_NAME}, ಹವಾಮಾನ ತಿಳಿಯಲು ದಯವಿಟ್ಟು ಲೊಕೇಶನ್ ಅನುಮತಿ ನೀಡಿ.`),
        { timeout: 8000 }
      );
    });
  }

  return null;
}

// ===== 5. CORE MESSAGE SEND PIPELINE =====
let isSending = false;

// Matches English & Kannada transliterations of "Jarvis" without \b issues
const WAKE_WORD_REGEX = /(?:hey\s+|ok\s+|hi\s+|hello\s+|ಹೇ\s+|ಹಾಯ್\s+)?(?:jarvis|jarvish|jervis|jarves|ಜಾರ್ವಿಸ್‌?|ಜಾರ್ವಿಶ್‌?|ಜರ್ವಿಸ್‌?)/i;

function isWakeWordOnly(text) {
  const stripped = text.replace(WAKE_WORD_REGEX, '').replace(/[\s.!?,:;-]+/g, '').trim();
  return WAKE_WORD_REGEX.test(text) && stripped.length === 0;
}

function stripLeadingWakeWord(text) {
  return text
    .replace(/^(?:hey\s+|ok\s+|hi\s+|hello\s+|ಹೇ\s+|ಹಾಯ್\s+)?(?:jarvis|jarvish|jervis|jarves|ಜಾರ್ವಿಸ್‌?|ಜಾರ್ವಿಶ್‌?|ಜರ್ವಿಸ್‌?)[\s.!?,:;-]*/i, '')
    .trim();
}

async function sendMessage(overrideText = null, imagePart = null) {
  if (isSending) return;
  const raw = overrideText !== null ? String(overrideText) : (input ? input.value : '');
  const text = raw.trim();
  if (!text && !imagePart) return;

  if (overrideText === null && input) {
    input.value = '';
    input.style.height = 'auto';
  }

  if (isWakeWordOnly(text) && !imagePart) {
    add('YOU: ' + text, 'user');
    const wakeReply = `Yes ${USER_NAME}! ನಾನು ಕೇಳುತ್ತಿದ್ದೇನೆ. ಹೇಳಿ ${USER_NAME}, ಈಗ ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?`;
    const replyNode = add('J.A.R.V.I.S: ' + wakeReply, 'ai');
    MEMORY.push({ role: 'user', text });
    MEMORY.push({ role: 'model', text: wakeReply });
    saveMemory();
    setReply(replyNode, 'J.A.R.V.I.S: ' + wakeReply);
    speakSweetly(wakeReply, () => {
      if (wakeModeEnabled) scheduleWakeRestart(150);
    });
    return;
  }

  const cleanedCommand = stripLeadingWakeWord(text) || text;

  add('YOU: ' + text, 'user');
  MEMORY.push({ role: 'user', text });
  saveMemory();

  isSending = true;
  if (sendBtn) sendBtn.disabled = true;
  setThinking(true, `J.A.R.V.I.S ${USER_NAME} ಗಾಗಿ ಯೋಚಿಸುತ್ತಿದೆ...`);

  const replyNode = add('J.A.R.V.I.S: ...', 'ai');

  try {
    let reply = null;
    if (!imagePart) {
      reply = await handleTools(cleanedCommand);
    }
    if (!reply) {
      reply = await requestGeminiReply(cleanedCommand, imagePart, statusMsg => {
        setThinking(true, statusMsg);
      });
    }

    MEMORY.push({ role: 'model', text: reply });
    saveMemory();
    setReply(replyNode, 'J.A.R.V.I.S: ' + reply);
    speakSweetly(reply, () => {
      if (wakeModeEnabled) scheduleWakeRestart(150);
    });
  } catch (err) {
    const errText = `ಕ್ಷಮಿಸಿ ${USER_NAME}, ದೋಷ ಸಂಭವಿಸಿದೆ: ${err?.message || 'Unknown error'}`;
    setReply(replyNode, 'J.A.R.V.I.S: ' + errText);
    speakSweetly(errText, () => {
      if (wakeModeEnabled) scheduleWakeRestart(150);
    });
  } finally {
    isSending = false;
    if (sendBtn) sendBtn.disabled = false;
    setThinking(false);
  }
}

// ===== 6. MOBILE-RELIABLE WAKE-WORD & VOICE COMMAND ENGINE =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeModeEnabled = true;
let wakeRecognition = null;
let wakeStarting = false;
let wakeRestartTimer = null;
let singleRecognition = null;
let awaitingCommandAfterWake = false;
let wakeCommandTimer = null;

function updateWakeUI(active, labelText = null) {
  if (wakeBtn) wakeBtn.classList.toggle('active', active);
  document.body.classList.toggle('wake-active', active);
  if (wakeStatus) {
    wakeStatus.textContent = labelText || (active ? 'WAKE: ON' : 'WAKE: OFF');
    wakeStatus.style.color = active ? '#00ffff' : '#888';
  }
}

function stopWakeListener() {
  wakeStarting = false;
  clearTimeout(wakeRestartTimer);
  if (wakeRecognition) {
    try {
      wakeRecognition.onresult = null;
      wakeRecognition.onerror = null;
      wakeRecognition.onend = null;
      wakeRecognition.abort();
    } catch (e) {}
    wakeRecognition = null;
  }
}

function scheduleWakeRestart(delayMs = 200) {
  clearTimeout(wakeRestartTimer);
  if (!wakeModeEnabled || isSpeaking || isSending || singleRecognition) return;
  wakeRestartTimer = setTimeout(() => {
    if (wakeModeEnabled && !isSpeaking && !isSending && !singleRecognition) {
      startWakeListener();
    }
  }, delayMs);
}

function startWakeListener() {
  if (!SpeechRecognition || !wakeModeEnabled || isSpeaking || isSending || wakeStarting || singleRecognition) return;
  stopWakeListener();
  wakeStarting = true;

  const rec = new SpeechRecognition();
  // Use en-IN for reliable "Jarvis" + Indian English & Kannada phonetic capture
  rec.lang = 'en-IN';
  rec.continuous = false; // Single-utterance loop prevents Android Chrome silent freezes
  rec.interimResults = true;
  rec.maxAlternatives = 3;

  let handledThisSession = false;

  rec.onstart = () => {
    wakeStarting = false;
    updateWakeUI(true, awaitingCommandAfterWake ? 'LISTENING...' : 'WAKE: ON');
  };

  rec.onresult = event => {
    if (handledThisSession) return;

    let finalTranscript = '';
    let interimTranscript = '';
    let allAlternativesText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const primary = result[0]?.transcript || '';
      if (result.isFinal) {
        finalTranscript += ' ' + primary;
      } else {
        interimTranscript += ' ' + primary;
      }
      for (let a = 0; a < result.length; a++) {
        allAlternativesText += ' ' + (result[a]?.transcript || '');
      }
    }

    finalTranscript = finalTranscript.trim();
    interimTranscript = interimTranscript.trim();
    const combined = (finalTranscript || interimTranscript).trim();

    if (combined) {
      updateWakeUI(true, 'HEARD: ' + combined.slice(0, 18));
    }

    // Case 1: Already awake and waiting for command
    if (awaitingCommandAfterWake && finalTranscript) {
      handledThisSession = true;
      clearTimeout(wakeCommandTimer);
      awaitingCommandAfterWake = false;
      stopWakeListener();
      const command = stripLeadingWakeWord(finalTranscript) || finalTranscript;
      sendMessage(command);
      return;
    }

    // Case 2: Heard "Jarvis" in final transcript (or any alternative)
    const heardWakeFinal = finalTranscript && (WAKE_WORD_REGEX.test(finalTranscript) || WAKE_WORD_REGEX.test(allAlternativesText));
    if (heardWakeFinal) {
      handledThisSession = true;
      const afterWake = stripLeadingWakeWord(finalTranscript);
      stopWakeListener();

      if (afterWake && !isWakeWordOnly(finalTranscript)) {
        awaitingCommandAfterWake = false;
        sendMessage(afterWake);
      } else {
        awaitingCommandAfterWake = true;
        updateWakeUI(true, 'LISTENING...');
        const greet = `Yes ${USER_NAME}! ನಾನು ಕೇಳುತ್ತಿದ್ದೇನೆ, ಹೇಳಿ.`;
        add('YOU: Jarvis', 'user');
        add('J.A.R.V.I.S: ' + greet, 'ai');
        speakSweetly(greet, () => {
          if (wakeModeEnabled) scheduleWakeRestart(100);
        });
        clearTimeout(wakeCommandTimer);
        wakeCommandTimer = setTimeout(() => {
          awaitingCommandAfterWake = false;
          if (wakeModeEnabled) updateWakeUI(true, 'WAKE: ON');
        }, 15000);
      }
      return;
    }

    // Case 3: Heard "Jarvis" alone in interim speech -> wake immediately if user pauses
    if (!finalTranscript && WAKE_WORD_REGEX.test(interimTranscript)) {
      updateWakeUI(true, 'HEARD JARVIS!');
    }
  };

  rec.onerror = event => {
    wakeStarting = false;
    wakeRecognition = null;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      updateWakeUI(false, 'TAP SCREEN / ALLOW MIC');
      return;
    }
    if (wakeModeEnabled && !isSpeaking && !isSending) {
      scheduleWakeRestart(event.error === 'no-speech' ? 120 : 500);
    }
  };

  rec.onend = () => {
    wakeStarting = false;
    wakeRecognition = null;
    if (wakeModeEnabled && !isSpeaking && !isSending && !handledThisSession) {
      scheduleWakeRestart(120);
    }
  };

  wakeRecognition = rec;
  try {
    rec.start();
  } catch (e) {
    wakeStarting = false;
    wakeRecognition = null;
    updateWakeUI(false, 'TAP SCREEN TO WAKE');
  }
}

function autoActivateHandsFree() {
  if (!SpeechRecognition) {
    updateWakeUI(false, 'NO VOICE API');
    return;
  }
  updateWakeUI(true, 'WAKE: ON');
  startWakeListener();

  const unlockAudioAndMic = () => {
    if ('speechSynthesis' in window) {
      try {
        const silent = new SpeechSynthesisUtterance('');
        silent.volume = 0;
        window.speechSynthesis.speak(silent);
      } catch (e) {}
    }
    if (wakeModeEnabled && !wakeRecognition && !isSpeaking && !isSending && !singleRecognition) {
      startWakeListener();
    }
  };

  window.addEventListener('pointerdown', unlockAudioAndMic);
  window.addEventListener('touchstart', unlockAudioAndMic);
  window.addEventListener('keydown', unlockAudioAndMic);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeModeEnabled && !wakeRecognition && !isSpeaking && !isSending) {
    scheduleWakeRestart(150);
  }
});

function toggleWakeMode() {
  if (!SpeechRecognition) {
    alert('Voice recognition is not supported in this browser.');
    return;
  }
  wakeModeEnabled = !wakeModeEnabled;
  if (wakeModeEnabled) {
    awaitingCommandAfterWake = false;
    updateWakeUI(true, 'WAKE: ON');
    speakSweetly(`Yes ${USER_NAME}, wake mode is active. Say Jarvis anytime.`, () => {
      scheduleWakeRestart(100);
    });
  } else {
    awaitingCommandAfterWake = false;
    clearTimeout(wakeCommandTimer);
    stopWakeListener();
    updateWakeUI(false, 'WAKE: OFF');
  }
}

// Single-tap composer mic button (supports Kannada + English commands)
function startSingleVoiceInput() {
  if (!SpeechRecognition) {
    alert('Speech recognition is not supported in this browser.');
    return;
  }
  if (singleRecognition) {
    try { singleRecognition.stop(); } catch (e) {}
    singleRecognition = null;
    micBtn?.classList.remove('listening');
    if (wakeModeEnabled) scheduleWakeRestart(150);
    return;
  }

  stopWakeListener();
  const rec = new SpeechRecognition();
  rec.lang = 'kn-IN';
  rec.continuous = false;
  rec.interimResults = true;

  let capturedFinal = '';

  rec.onstart = () => {
    micBtn?.classList.add('listening');
    if (input) input.placeholder = 'ಮಾತನಾಡಿ... (Listening...)';
  };

  rec.onresult = event => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0]?.transcript || '';
    }
    if (input) input.value = transcript;
    if (event.results[event.results.length - 1]?.isFinal) {
      capturedFinal = transcript.trim();
    }
  };

  rec.onerror = event => {
    micBtn?.classList.remove('listening');
    if (input) input.placeholder = `Message J.A.R.V.I.S, ${USER_NAME}...`;
    if (event.error === 'not-allowed') {
      alert('Please allow microphone permission in Chrome site settings.');
    }
  };

  rec.onend = () => {
    singleRecognition = null;
    micBtn?.classList.remove('listening');
    const textToSend = (capturedFinal || input?.value || '').trim();
    if (input) input.placeholder = `Message J.A.R.V.I.S, ${USER_NAME}...`;
    if (textToSend) {
      sendMessage(textToSend);
    } else if (wakeModeEnabled && !isSpeaking && !isSending) {
      scheduleWakeRestart(150);
    }
  };

  singleRecognition = rec;
  try {
    rec.start();
  } catch (e) {
    singleRecognition = null;
    micBtn?.classList.remove('listening');
  }
}

// ===== 7. EVENT LISTENERS =====
sendBtn?.addEventListener('click', () => sendMessage());

input?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

input?.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
});

wakeBtn?.addEventListener('click', toggleWakeMode);
micBtn?.addEventListener('click', startSingleVoiceInput);
clearBtn?.addEventListener('click', clearCurrentConversation);
newChatBtn?.addEventListener('click', startNewConversation);
menuButton?.addEventListener('click', toggleSidebar);
sidebarToggle?.addEventListener('click', toggleSidebar);
sidebarBackdrop?.addEventListener('click', closeSidebarOnMobile);
settingsOpen?.addEventListener('click', openSettings);
topbarSettingsBtn?.addEventListener('click', openSettings);
settingsClose?.addEventListener('click', closeSettings);
settingsScrim?.addEventListener('click', closeSettings);
clearMemorySetting?.addEventListener('click', () => {
  clearCurrentConversation();
  closeSettings();
});

themeSelect?.addEventListener('change', e => applyTheme(e.target.value));

voiceSelect?.addEventListener('change', e => {
  SELECTED_VOICE_ID = e.target.value;
  localStorage.setItem(VOICE_KEY, SELECTED_VOICE_ID);
  const preset = VOICE_PRESETS.find(v => v.id === SELECTED_VOICE_ID);
  const labelName = preset ? preset.label.replace(/^\d+\.\s*/, '') : 'updated';
  speakSweetly(`Hello ${USER_NAME}! ನನ್ನ ಹೊಸ ಧ್ವನಿ ${labelName} ಆಗಿದೆ.`, () => {
    if (wakeModeEnabled) scheduleWakeRestart(150);
  });
});

testVoiceBtn?.addEventListener('click', () => {
  const preset = VOICE_PRESETS.find(v => v.id === SELECTED_VOICE_ID);
  const labelName = preset ? preset.label.replace(/^\d+\.\s*/, '') : 'J.A.R.V.I.S';
  speakSweetly(`Hello ${USER_NAME}, this is ${labelName}. ನಮಸ್ಕಾರ ${USER_NAME}, ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ಸಿದ್ಧವಾಗಿದ್ದೇನೆ.`, () => {
    if (wakeModeEnabled) scheduleWakeRestart(150);
  });
});

document.querySelectorAll('.prompt-card').forEach(card => {
  card.addEventListener('click', () => {
    const promptText = card.getAttribute('data-prompt');
    if (promptText) sendMessage(promptText);
  });
});

camBtn?.addEventListener('click', () => imgInput?.click());
imgInput?.addEventListener('change', () => {
  const file = imgInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      const caption = (input?.value || '').trim() || 'ಈ ಚಿತ್ರದಲ್ಲಿ ಏನಿದೆ ಎಂದು ಕನ್ನಡದಲ್ಲಿ ವಿವರಿಸಿ.';
      if (input) input.value = '';
      sendMessage(caption, {
        inlineData: {
          mimeType: file.type || 'image/jpeg',
          data: base64
        }
      });
    }
  };
  reader.readAsDataURL(file);
  imgInput.value = '';
});

autoActivateHandsFree();
