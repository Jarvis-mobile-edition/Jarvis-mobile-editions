// ===== 1. API KEY & SMART MODELS =====
let API_KEY = localStorage.getItem('jarvis_key');

function requestApiKey(force = false) {
  if (!API_KEY || force) {
    const key = prompt('Enter your Gemini API Key:');
    if (key && key.trim()) {
      API_KEY = key.trim();
      localStorage.setItem('jarvis_key', API_KEY);
    }
  }
}
requestApiKey();

// Latest active Gemini API model IDs (with automatic fallbacks)
const MODELS = [
  "gemini-4-hydrogen",    // Latest general-purpose & agent model
  "gemini-3.8-flash",     // Fast, capable workhorse model
  "gemini-3.5-flash-lite" // Ultra-fast, low-cost fallback
];

const SYSTEM_PROMPT = {
  parts: [{
    text: "You are J.A.R.V.I.S, a witty, hyper-competent personal AI assistant. Keep answers concise, sharp, and conversational. Do not use markdown formatting like asterisks or hashtags since your responses are spoken aloud."
  }]
};

// ===== 2. MEMORY & DOM ELEMENTS =====
let MEMORY = JSON.parse(localStorage.getItem('jarvis_memory') || '[]');
function saveMemory() {
  localStorage.setItem('jarvis_memory', JSON.stringify(MEMORY));
}

const chat = document.getElementById('chat');
const input = document.getElementById('msg');
const sendBtn = document.getElementById('send');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const keyBtn = document.getElementById('key-btn');
const camBtn = document.getElementById('cam-btn');
const imgInput = document.getElementById('img-input');
const coreText = document.querySelector('.core-text');
const engineStatus = document.getElementById('engine-status');

MEMORY.forEach(m => add((m.role === 'user' ? 'YOU: ' : 'J.A.R.V.I.S: ') + m.text, m.role === 'user' ? 'user' : 'ai'));

function setStatus(text, isOnline = true) {
  if (coreText) coreText.innerText = text;
  if (engineStatus) {
    engineStatus.innerText = isOnline ? '• OPERATIONAL' : '• ERROR';
    engineStatus.className = isOnline ? 'on' : 'off';
  }
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// ===== 3. TOOLS (THE HANDS) - 5 TOOLS =====
async function handleTools(text) {
  const t = text.toLowerCase();

  // 1. Time
  if (/\btime\b/.test(t) || t.includes('టైం') || t.includes('సమయం')) {
    return `The time is ${new Date().toLocaleTimeString()}, Boss.`;
  }

  // 2. Weather
  if (t.includes('weather') || t.includes('వాతావరణం')) {
    if (!navigator.geolocation) {
      return 'Geolocation is not supported by your browser, Boss.';
    }
    return await new Promise(res => {
      navigator.geolocation.getCurrentPosition(async p => {
        try {
          const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.coords.latitude}&longitude=${p.coords.longitude}&current_weather=true`);
          const d = await r.json();
          res(`It is ${d.current_weather.temperature} degrees Celsius now, Boss.`);
        } catch (e) {
          res('Weather service error, Boss.');
        }
      }, () => res('I need location permission for weather, Boss.'));
    });
  }

  // 3. Timer
  const m = t.match(/(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i);
  if ((t.includes('timer') || t.includes('టైమర్')) && m) {
    const amount = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const factor = /^(hours?|hrs?)$/i.test(unit) ? 3600000 : /^(seconds?|secs?|s)$/i.test(unit) ? 1000 : 60000;
    const duration = amount * factor;
    setTimeout(() => {
      speak(`టైమర్ పూర్తయింది! ${amount} ${unit} పూర్తయ్యాయి.`);
      add(`J.A.R.V.I.S: Timer done! (${amount} ${unit})`, 'ai');
    }, duration);
    return `Timer set for ${amount} ${unit}, Boss.`;
  }

  // 4. Translate (English to Telugu)
  if (t.includes('translate')) {
    const q = text.replace(/translate\s*(this)?/i, '').trim() || 'Hello';
    try {
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|te`);
      const d = await r.json();
      return `In Telugu: ${d.responseData.translatedText}`;
    } catch (e) {
      return 'Translate error, Boss.';
    }
  }

  // 5. YouTube Play
  if (t.includes('play ') || t.includes('youtube ')) {
    const q = text.replace(/^(play|youtube|search)\s*/i, '').trim();
    if (q) {
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, '_blank');
      return `Searching YouTube for '${q}', Boss.`;
    }
  }

  return null; // If no tool matches, forward to Gemini Brain
}

// ===== 4. UNIFIED GEMINI FETCH WITH TIMEOUT, RETRY & FALLBACK =====
async function fetchGemini(contents, retries = 1) {
  if (!API_KEY) {
    requestApiKey(true);
    if (!API_KEY) throw new Error("API Key required. Tap 🔑 to enter your key.");
  }

  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const m of MODELS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: SYSTEM_PROMPT,
            contents: contents
          })
        });
        clearTimeout(timeoutId);

        const data = await res.json();

        if (!res.ok || data.error) {
          const errMsg = data.error?.message || `HTTP ${res.status}`;
          lastErr = new Error(errMsg);

          if (res.status === 400 || res.status === 401 || res.status === 403 || /API key/i.test(errMsg)) {
            lastErr.fatal = true;
            throw lastErr;
          }
          continue;
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("Empty response from neural core.");
        }

        return text;
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
          lastErr = new Error("Connection timed out (15s). Check your network.");
        } else {
          lastErr = e;
        }
        if (lastErr.fatal) throw lastErr;
      }
    }

    if (attempt < retries) {
      setStatus(`RETRYING (${attempt + 1}/${retries})...`, true);
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr || new Error("Failed to reach neural core.");
}

// ===== 5. TEXT & MEMORY ENGINE =====
async function askGemini(p) {
  setStatus('PROCESSING...', true);
  const botBubble = add('J.A.R.V.I.S: Thinking...', 'ai');

  // Check local tools first
  const toolReply = await handleTools(p);
  if (toolReply) {
    MEMORY.push({ role: 'user', text: p });
    MEMORY.push({ role: 'model', text: toolReply });
    saveMemory();

    botBubble.innerText = 'J.A.R.V.I.S: ' + toolReply;
    if (chat) chat.scrollTop = chat.scrollHeight;
    setStatus('SYSTEM READY', true);
    speak(toolReply);
    return;
  }

  // Otherwise use Gemini API
  const contents = MEMORY.slice(-12).map(m => ({
    role: m.role,
    parts: [{ text: m.text }]
  }));
  contents.push({ role: 'user', parts: [{ text: p }] });

  try {
    const reply = await fetchGemini(contents);
    MEMORY.push({ role: 'user', text: p });
    MEMORY.push({ role: 'model', text: reply });
    saveMemory();

    botBubble.innerText = 'J.A.R.V.I.S: ' + reply;
    if (chat) chat.scrollTop = chat.scrollHeight;
    setStatus('SYSTEM READY', true);
    speak(reply);
  } catch (e) {
    botBubble.innerText = 'J.A.R.V.I.S: ERROR - ' + e.message;
    if (chat) chat.scrollTop = chat.scrollHeight;
    setStatus('CORE OFFLINE', false);
  }
}

// ===== 6. VISION ENGINE (EYES) =====
if (camBtn && imgInput) {
  camBtn.onclick = () => imgInput.click();
  imgInput.onchange = () => {
    const file = imgInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      const q = input.value.trim() || 'What do you see? Describe briefly.';
      add('YOU: [IMAGE] ' + q, 'user');
      input.value = '';
      askVision(base64, file.type, q);
    };
    reader.readAsDataURL(file);
    imgInput.value = '';
  };
}

async function askVision(base64, mime, q) {
  setStatus('ANALYZING VISUALS...', true);
  const botBubble = add('J.A.R.V.I.S: Analyzing image...', 'ai');

  const contents = [{
    parts: [
      { text: q },
      { inline_data: { mime_type: mime, data: base64 } }
    ]
  }];

  try {
    const reply = await fetchGemini(contents);
    botBubble.innerText = 'J.A.R.V.I.S: ' + reply;
    if (chat) chat.scrollTop = chat.scrollHeight;
    setStatus('SYSTEM READY', true);
    speak(reply);
  } catch (e) {
    botBubble.innerText = 'J.A.R.V.I.S: ERROR - ' + e.message;
    if (chat) chat.scrollTop = chat.scrollHeight;
    setStatus('CORE OFFLINE', false);
  }
}

// ===== 7. VOICE & UTILS =====
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR && micBtn) {
  const rec = new SR();
  rec.lang = 'en-US';
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    add('YOU: ' + t, 'user');
    askGemini(t);
  };
  rec.onerror = () => {
    micBtn.innerText = '🎙️';
    setStatus('SYSTEM READY', true);
  };
  micBtn.onclick = () => {
    if (window.speechSynthesis) speechSynthesis.cancel();
    rec.start();
    micBtn.innerText = '...';
    setStatus('LISTENING...', true);
  };
  rec.onend = () => {
    micBtn.innerText = '🎙️';
  };
}

let voices = [];
function loadVoices() {
  if (window.speechSynthesis) {
    voices = speechSynthesis.getVoices();
  }
}
loadVoices();
if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speak(t) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const cleanText = t.replace(/[*#_`]/g, '');
  const u = new SpeechSynthesisUtterance(cleanText);
  u.rate = 1.05;
  u.pitch = 0.85;
  const v = voices.find(v => v.lang.includes('en-GB')) || voices.find(v => v.lang.startsWith('en'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

function handleSend() {
  const t = input.value.trim();
  if (!t) return;
  add('YOU: ' + t, 'user');
  input.value = '';
  askGemini(t);
}

if (sendBtn) sendBtn.onclick = handleSend;
if (input) {
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
}

if (clearBtn) {
  clearBtn.onclick = () => {
    MEMORY = [];
    saveMemory();
    if (chat) chat.innerHTML = '';
    if (window.speechSynthesis) speechSynthesis.cancel();
    setStatus('SYSTEM READY', true);
    add('SYSTEM: Memory cleared.', 'ai');
  };
}

if (keyBtn) {
  keyBtn.onclick = () => {
    requestApiKey(true);
    setStatus('SYSTEM READY', true);
    add('SYSTEM: API key updated.', 'ai');
  };
}

function add(t, w) {
  const d = document.createElement('div');
  d.className = 'msg ' + w;
  d.innerText = t;
  if (chat) {
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  }
  return d;
}
