/* ============================================================
   NoirAI — script.js
   Full-featured AI chat application powered by OpenRouter API
   ============================================================ */

// ── App State ────────────────────────────────────────────────
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
const SUPPORTED_MODELS = new Set([
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/llama-nemotron-embed-vl-1b-v2:free',
  'stepfun/step-3.5-flash:free',
]);

const state = {
  user: null,                    // Authenticated user object
  apiKey: null,                  // OpenRouter API key
  currentModel: DEFAULT_MODEL,
  currentChatId: null,
  chats: {},                     // { id: { title, messages, createdAt } }
  isStreaming: false,
  currentMode: 'default',
  attachedFiles: [],             // Files queued for next message
  renamingChatId: null,
  shouldAutoScroll: true,
  lastUserMessage: null,         // For regenerate
};

// ── Mode Prompts ────────────────────────────────────────────
const MODE_PROMPTS = {
  default:  'You are NoirAI, a helpful, intelligent and friendly assistant. Be concise, clear and thoughtful.',
  coder:    'You are NoirAI in Coder Mode — a senior software engineer. Focus on code quality, best practices, and clear explanations. Always provide code examples with syntax highlighting. Prefer brevity and precision.',
  creative: 'You are NoirAI in Creative Mode — an imaginative storyteller and creative partner. Be vivid, expressive, and inventive. Embrace metaphor and narrative.',
  study:    'You are NoirAI in Study Mode — a patient and thorough tutor. Break down complex topics step by step. Use analogies, examples and summaries. Encourage understanding over memorization.',
};

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPersistedState();

  if (!state.user) {
    showAuth();
  } else {
    hideAuth();
    initApp();
  }
});

function loadPersistedState() {
  // Load user session
  const savedUser = localStorage.getItem('noir_user');
  if (savedUser) state.user = JSON.parse(savedUser);

  // Load API key
  state.apiKey = localStorage.getItem('noir_api_key') || null;

  // Load chats
  const savedChats = localStorage.getItem('noir_chats');
  if (savedChats) state.chats = JSON.parse(savedChats);

  // Load model preference and fall back to default if invalid/missing
  const savedModel = localStorage.getItem('noir_model');
  state.currentModel = SUPPORTED_MODELS.has(savedModel) ? savedModel : DEFAULT_MODEL;
  if (state.currentModel !== savedModel) {
    localStorage.setItem('noir_model', state.currentModel);
  }

  // Load mode
  state.currentMode = localStorage.getItem('noir_mode') || 'default';
}

function saveChats() {
  localStorage.setItem('noir_chats', JSON.stringify(state.chats));
}

// ── Authentication ───────────────────────────────────────────
function showAuth() {
  document.getElementById('authOverlay').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function hideAuth() {
  document.getElementById('authOverlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

// Tab switching
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    document.getElementById('signinForm').classList.toggle('hidden', which !== 'signin');
    document.getElementById('signupForm').classList.toggle('hidden', which !== 'signup');
    document.getElementById('authError').classList.add('hidden');
  });
});

function handleSignIn() {
  const email = document.getElementById('signinEmail').value.trim();
  const password = document.getElementById('signinPassword').value;

  if (!email || !password) return showAuthError('Please fill in all fields.');

  // Simulate local auth — check if user exists
  const users = JSON.parse(localStorage.getItem('noir_users') || '{}');
  const user = users[email];

  if (!user) return showAuthError('No account found. Please sign up.');
  if (user.password !== btoa(password)) return showAuthError('Incorrect password.');

  loginUser({ email, name: user.name });
}

function handleSignUp() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;

  if (!name || !email || !password) return showAuthError('Please fill in all fields.');
  if (password.length < 6) return showAuthError('Password must be at least 6 characters.');

  const users = JSON.parse(localStorage.getItem('noir_users') || '{}');
  if (users[email]) return showAuthError('Account already exists. Please sign in.');

  users[email] = { name, password: btoa(password) };
  localStorage.setItem('noir_users', JSON.stringify(users));

  loginUser({ email, name });
}

function handleGuestLogin() {
  loginUser({ email: 'guest@noirai.com', name: 'Guest' });
}

function loginUser(user) {
  state.user = user;
  localStorage.setItem('noir_user', JSON.stringify(user));
  hideAuth();
  initApp();
}

function signOut() {
  state.user = null;
  localStorage.removeItem('noir_user');
  showAuth();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── App Initialization ────────────────────────────────────────
function initApp() {
  // Update user UI
  const name = state.user?.name || 'Guest';
  document.getElementById('userName').textContent = name;
  document.getElementById('userAvatar').textContent = name[0]?.toUpperCase() || 'G';

  // Set model selector
  const modelEl = document.getElementById('modelSelect');
  modelEl.value = state.currentModel;

  // Restore mode
  setMode(state.currentMode, document.querySelector(`.mode-btn[data-mode="${state.currentMode}"]`));

  // Render chat history
  renderChatHistory();

  // Show API key prompt if missing
  if (!state.apiKey) {
    showApiKeyModal();
  }

  // Setup scroll tracking
  const container = document.getElementById('messagesContainer');
  container.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = container;
    state.shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 80;
  });

  // Create a new chat if none
  if (Object.keys(state.chats).length === 0) {
    createNewChat();
  } else {
    // Load the most recent chat
    const ids = Object.keys(state.chats).sort((a, b) =>
      state.chats[b].createdAt - state.chats[a].createdAt
    );
    loadChat(ids[0]);
  }

  // Add sidebar overlay for mobile
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.id = 'sidebarOverlay';
  overlay.onclick = () => toggleSidebar();
  document.body.appendChild(overlay);
}

// ── API Key ────────────────────────────────────────────────────
function showApiKeyModal() {
  document.getElementById('apiKeyModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('apiKeyInput').focus(), 100);
}

function openApiKeyModal() {
  document.getElementById('apiKeyInput').value = state.apiKey || '';
  document.getElementById('apiKeyModal').classList.remove('hidden');
}

function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (key) {
    state.apiKey = key;
    localStorage.setItem('noir_api_key', key);
    showToast('API key saved ✓');
  }
  document.getElementById('apiKeyModal').classList.add('hidden');
}

function skipApiKey() {
  document.getElementById('apiKeyModal').classList.add('hidden');
}

// ── Chat Management ───────────────────────────────────────────
function createNewChat() {
  const id = 'chat_' + Date.now();
  state.chats[id] = {
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
  };
  saveChats();
  loadChat(id);
  return id;
}

function newChat() {
  createNewChat();
  renderChatHistory();
  // Close sidebar on mobile
  if (window.innerWidth <= 768) toggleSidebar(false);
}

function loadChat(id) {
  state.currentChatId = id;
  const chat = state.chats[id];

  // Update title
  document.getElementById('currentChatTitle').textContent = chat.title;

  // Render messages
  const list = document.getElementById('messagesList');
  list.innerHTML = '';

  const welcomeState = document.getElementById('welcomeState');
  if (chat.messages.length === 0) {
    welcomeState.style.display = '';
    list.style.display = 'none';
  } else {
    welcomeState.style.display = 'none';
    list.style.display = '';
    chat.messages.forEach(msg => renderMessage(msg, false));
  }

  // Mark active in sidebar
  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.chatId === id);
  });

  scrollToBottom(true);
}

function renderChatHistory() {
  const list = document.getElementById('chatHistoryList');
  list.innerHTML = '';

  const sortedIds = Object.keys(state.chats).sort((a, b) =>
    state.chats[b].createdAt - state.chats[a].createdAt
  );

  sortedIds.forEach(id => {
    const chat = state.chats[id];
    const item = document.createElement('div');
    item.className = 'chat-item' + (id === state.currentChatId ? ' active' : '');
    item.dataset.chatId = id;

    item.innerHTML = `
      <span class="chat-item-icon">💬</span>
      <span class="chat-item-name">${escapeHtml(chat.title)}</span>
      <div class="chat-item-actions">
        <button class="chat-item-btn" onclick="startRename('${id}', event)" title="Rename">✎</button>
        <button class="chat-item-btn" onclick="deleteChat('${id}', event)" title="Delete">✕</button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.chat-item-actions')) return;
      loadChat(id);
      if (window.innerWidth <= 768) toggleSidebar(false);
    });

    list.appendChild(item);
  });
}

function deleteChat(id, e) {
  e.stopPropagation();
  delete state.chats[id];
  saveChats();

  if (state.currentChatId === id) {
    const remaining = Object.keys(state.chats);
    if (remaining.length > 0) {
      loadChat(remaining[0]);
    } else {
      createNewChat();
    }
  }
  renderChatHistory();
}

function startRename(id, e) {
  e.stopPropagation();
  state.renamingChatId = id;
  document.getElementById('renameInput').value = state.chats[id].title;
  document.getElementById('renameModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('renameInput').focus(), 100);
}

function confirmRename() {
  const newName = document.getElementById('renameInput').value.trim();
  if (newName && state.renamingChatId) {
    state.chats[state.renamingChatId].title = newName;
    if (state.renamingChatId === state.currentChatId) {
      document.getElementById('currentChatTitle').textContent = newName;
    }
    saveChats();
    renderChatHistory();
  }
  closeRenameModal();
}

function closeRenameModal() {
  document.getElementById('renameModal').classList.add('hidden');
  state.renamingChatId = null;
}

function clearCurrentChat() {
  if (!state.currentChatId) return;
  state.chats[state.currentChatId].messages = [];
  state.chats[state.currentChatId].title = 'New Chat';
  saveChats();
  loadChat(state.currentChatId);
  renderChatHistory();
  showToast('Chat cleared');
}

// ── Mode ──────────────────────────────────────────────────────
function setMode(mode, btn) {
  state.currentMode = mode;
  localStorage.setItem('noir_mode', mode);

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const labels = { default: 'Default mode', coder: 'Coder mode', creative: 'Creative mode', study: 'Study mode' };
  document.getElementById('modeLabel').textContent = labels[mode] || 'Default mode';
}

// ── Model ─────────────────────────────────────────────────────
function changeModel(value) {
  state.currentModel = value;
  localStorage.setItem('noir_model', value);
  showToast('Model switched ✓');
}

// ── Sidebar ───────────────────────────────────────────────────
function toggleSidebar(forceState) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const isMobile = window.innerWidth <= 768;

  const shouldCollapse = typeof forceState === 'boolean' ? !forceState : !sidebar.classList.contains('collapsed');

  sidebar.classList.toggle('collapsed', shouldCollapse);

  if (isMobile && overlay) {
    overlay.classList.toggle('visible', !shouldCollapse);
  }
}

// ── File Upload ───────────────────────────────────────────────
function handleFileUpload(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      state.attachedFiles.push({
        name: file.name,
        type: file.type,
        size: file.size,
        data: e.target.result,
        isImage: file.type.startsWith('image/'),
      });
      renderFilePreview();
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

function renderFilePreview() {
  const preview = document.getElementById('filePreview');
  if (state.attachedFiles.length === 0) {
    preview.classList.add('hidden');
    return;
  }
  preview.classList.remove('hidden');
  preview.innerHTML = state.attachedFiles.map((f, i) => `
    <div class="file-chip">
      <span>${f.isImage ? '🖼' : '📄'}</span>
      <span>${escapeHtml(f.name)}</span>
      <span class="file-chip-remove" onclick="removeFile(${i})">✕</span>
    </div>
  `).join('');
}

function removeFile(index) {
  state.attachedFiles.splice(index, 1);
  renderFilePreview();
}

// ── Suggestions ───────────────────────────────────────────────
function useSuggestion(text) {
  document.getElementById('messageInput').value = text;
  autoResize(document.getElementById('messageInput'));
  sendMessage();
}

// ── Sending Messages ──────────────────────────────────────────
function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

async function sendMessage(customContent) {
  if (state.isStreaming) return;

  const input = document.getElementById('messageInput');
  const content = customContent || input.value.trim();

  if (!content && state.attachedFiles.length === 0) return;

  if (!state.apiKey) {
    showApiKeyModal();
    return;
  }

  // Reset input
  if (!customContent) {
    input.value = '';
    input.style.height = 'auto';
  }

  state.lastUserMessage = content;

  // Build message content
  let messageContent = content;
  let fileContext = '';

  if (state.attachedFiles.length > 0) {
    const textFiles = state.attachedFiles.filter(f => !f.isImage);
    textFiles.forEach(f => {
      // Decode base64 text files
      try {
        const decoded = atob(f.data.split(',')[1]);
        fileContext += `\n\n[File: ${f.name}]\n\`\`\`\n${decoded.slice(0, 4000)}\n\`\`\``;
      } catch {}
    });
    if (textFiles.length > 0) {
      messageContent = content + fileContext;
    }
  }

  // Add user message to state
  const userMsg = {
    id: 'msg_' + Date.now(),
    role: 'user',
    content: messageContent,
    displayContent: content,
    files: [...state.attachedFiles],
    timestamp: Date.now(),
  };

  state.attachedFiles = [];
  renderFilePreview();

  const chat = state.chats[state.currentChatId];
  chat.messages.push(userMsg);

  // Hide welcome, show messages
  document.getElementById('welcomeState').style.display = 'none';
  document.getElementById('messagesList').style.display = '';

  renderMessage(userMsg);
  showTypingIndicator();
  setStatus('thinking');
  state.isStreaming = true;
  document.getElementById('sendBtn').disabled = true;

  // Auto-title the chat after first message
  if (chat.messages.length === 1) {
    const words = content.split(' ').slice(0, 6).join(' ');
    chat.title = words.length > 40 ? words.slice(0, 40) + '…' : words || 'New Chat';
    document.getElementById('currentChatTitle').textContent = chat.title;
    renderChatHistory();
  }

  saveChats();

  // Build API messages
  const apiMessages = buildApiMessages();

  // Stream response
  const aiMsgId = 'msg_' + (Date.now() + 1);
  let fullResponse = '';

  try {
    fullResponse = await streamResponse(apiMessages, (chunk) => {
      hideTypingIndicator();
      if (!document.getElementById(aiMsgId)) {
        // Create AI message bubble on first chunk
        const aiMsg = {
          id: aiMsgId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        };
        renderMessage(aiMsg);
      }
      fullResponse += chunk;
      updateStreamingMessage(aiMsgId, fullResponse);
      if (state.shouldAutoScroll) scrollToBottom();
    });

    // Finalize message
    const aiMessage = {
      id: aiMsgId,
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now(),
    };

    chat.messages.push(aiMessage);
    finalizeMessage(aiMsgId, fullResponse);
    saveChats();

  } catch (err) {
    hideTypingIndicator();
    renderErrorMessage(err.message || 'Something went wrong. Please try again.');
  } finally {
    state.isStreaming = false;
    document.getElementById('sendBtn').disabled = false;
    setStatus('online');
  }
}

function buildApiMessages() {
  const chat = state.chats[state.currentChatId];
  const systemPrompt = MODE_PROMPTS[state.currentMode] || MODE_PROMPTS.default;

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // Include last N messages for context
  const MAX_CONTEXT = 20;
  const contextMessages = chat.messages.slice(-MAX_CONTEXT);

  contextMessages.forEach(msg => {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: msg.content || '',
      });
    }
  });

  return messages;
}

// ── OpenRouter Streaming API ──────────────────────────────────
async function streamResponse(messages, onChunk) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.apiKey}`,
      'HTTP-Referer': window.location.href,
      'X-Title': 'NoirAI',
    },
    body: JSON.stringify({
      model: state.currentModel,
      messages,
      stream: true,
      max_tokens: 2048,
      temperature: state.currentMode === 'creative' ? 0.9 : 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const msg = error?.error?.message || `API Error ${response.status}`;
    throw new Error(msg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onChunk(delta);
        }
      } catch {}
    }
  }

  return fullText;
}

// ── Message Rendering ─────────────────────────────────────────
function renderMessage(msg, scroll = true) {
  const list = document.getElementById('messagesList');
  const isUser = msg.role === 'user';

  const group = document.createElement('div');
  group.className = `message-group ${isUser ? 'user' : 'ai'}`;
  group.id = msg.id;

  const time = formatTime(msg.timestamp);
  const name = isUser ? (state.user?.name || 'You') : 'NoirAI';

  const filesHtml = (msg.files || []).map(f => `
    <div class="file-attachment">
      <span class="file-attachment-icon">${f.isImage ? '🖼' : '📄'}</span>
      <span>${escapeHtml(f.name)}</span>
    </div>
  `).join('');

  const displayContent = msg.displayContent || msg.content || '';
  const bubbleContent = isUser
    ? `${filesHtml}<div class="user-text">${escapeHtml(displayContent).replace(/\n/g, '<br>')}</div>`
    : renderMarkdown(msg.content || '');

  const actionsHtml = isUser ? '' : `
    <div class="msg-actions">
      <button class="msg-action-btn" onclick="copyMessage('${msg.id}')" title="Copy">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy
      </button>
      <button class="msg-action-btn" onclick="regenerateMessage()" title="Regenerate">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
        Regenerate
      </button>
      <button class="msg-action-btn like-btn" onclick="likeMessage('${msg.id}', 'like')" title="Good response">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
      </button>
      <button class="msg-action-btn dislike-btn" onclick="likeMessage('${msg.id}', 'dislike')" title="Bad response">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
      </button>
    </div>
  `;

  group.innerHTML = `
    <div class="msg-avatar ${isUser ? 'user' : 'ai'}">${isUser ? (state.user?.name?.[0]?.toUpperCase() || 'U') : 'N'}</div>
    <div class="msg-content-wrap">
      <div class="msg-meta">
        <span class="msg-name">${escapeHtml(name)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-bubble ${isUser ? 'user-bubble' : 'ai-bubble'}" id="bubble-${msg.id}">
        ${bubbleContent}
      </div>
      ${actionsHtml}
    </div>
  `;

  // Apply syntax highlighting to code blocks
  group.querySelectorAll('pre code').forEach(block => {
    hljs.highlightElement(block);
    addCodeCopyButton(block);
  });

  list.appendChild(group);

  if (scroll && state.shouldAutoScroll) scrollToBottom();
}

function renderMarkdown(content) {
  if (!content) return '';
  try {
    // Configure marked
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      }
    });

    let html = marked.parse(content);

    // Wrap code blocks with header showing language
    html = html.replace(/<pre><code class="(language-\S+)">/g, (match, lang) => {
      const cleanLang = lang.replace('language-', '');
      return `<pre><div class="code-header"><span>${cleanLang}</span><button class="copy-code-btn" onclick="copyCodeBlock(this)">Copy</button></div><code class="${lang}">`;
    });

    // Wrap plain code blocks
    html = html.replace(/<pre><code>/g, `<pre><div class="code-header"><span>code</span><button class="copy-code-btn" onclick="copyCodeBlock(this)">Copy</button></div><code>`);

    return html;
  } catch {
    return escapeHtml(content).replace(/\n/g, '<br>');
  }
}

function updateStreamingMessage(id, content) {
  const bubble = document.getElementById(`bubble-${id}`);
  if (bubble) {
    bubble.innerHTML = renderMarkdown(content) + '<span class="streaming-cursor">▋</span>';
  }
}

function finalizeMessage(id, content) {
  const bubble = document.getElementById(`bubble-${id}`);
  if (bubble) {
    bubble.innerHTML = renderMarkdown(content);
    bubble.querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block);
    });
  }
}

function addCodeCopyButton(block) {
  // Already added via renderMarkdown template, skip
}

function renderErrorMessage(errorMsg) {
  const list = document.getElementById('messagesList');
  const div = document.createElement('div');
  div.className = 'message-group ai';
  div.innerHTML = `
    <div class="msg-avatar ai">N</div>
    <div class="msg-content-wrap">
      <div class="error-message">
        <div>
          <strong>Something went wrong</strong><br>
          ${escapeHtml(errorMsg)}
          <br>
          <button class="error-retry" onclick="retryLastMessage()">↺ Retry</button>
        </div>
      </div>
    </div>
  `;
  list.appendChild(div);
  scrollToBottom();
}

// ── Message Actions ───────────────────────────────────────────
function copyMessage(msgId) {
  const chat = state.chats[state.currentChatId];
  const msg = chat?.messages.find(m => m.id === msgId);
  if (!msg) return;

  navigator.clipboard.writeText(msg.content).then(() => {
    const btn = document.querySelector(`#${msgId} .msg-action-btn`);
    if (btn) {
      btn.classList.add('copied');
      btn.textContent = '✓ Copied';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
      }, 2000);
    }
    showToast('Copied to clipboard');
  });
}

function copyCodeBlock(btn) {
  const pre = btn.closest('pre');
  const code = pre?.querySelector('code');
  if (!code) return;

  navigator.clipboard.writeText(code.textContent).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.color = 'var(--pink)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.color = '';
    }, 2000);
  });
}

function likeMessage(msgId, type) {
  const btn = document.querySelector(`#${msgId} .${type === 'like' ? 'like-btn' : 'dislike-btn'}`);
  const other = document.querySelector(`#${msgId} .${type === 'like' ? 'dislike-btn' : 'like-btn'}`);
  if (!btn) return;

  const isActive = btn.classList.contains(type === 'like' ? 'liked' : 'disliked');

  if (other) other.classList.remove('liked', 'disliked');
  btn.classList.toggle(type === 'like' ? 'liked' : 'disliked', !isActive);

  if (!isActive) showToast(type === 'like' ? 'Feedback noted — glad it helped!' : 'Thanks for the feedback');
}

async function regenerateMessage() {
  if (state.isStreaming || !state.lastUserMessage) return;

  // Remove last AI message from state and DOM
  const chat = state.chats[state.currentChatId];
  const lastMsg = chat.messages[chat.messages.length - 1];
  if (lastMsg?.role === 'assistant') {
    const el = document.getElementById(lastMsg.id);
    if (el) el.remove();
    chat.messages.pop();
    saveChats();
  }

  // Re-send last user message
  await sendMessage(state.lastUserMessage);
}

function retryLastMessage() {
  if (state.lastUserMessage) {
    // Remove error message
    const list = document.getElementById('messagesList');
    const lastChild = list.lastElementChild;
    if (lastChild?.querySelector('.error-message')) lastChild.remove();

    // Also remove last user message from state (it'll be re-added)
    const chat = state.chats[state.currentChatId];
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg?.role === 'user') {
      const el = document.getElementById(lastMsg.id);
      if (el) el.remove();
      chat.messages.pop();
    }

    sendMessage(state.lastUserMessage);
  }
}

// ── Typing Indicator ─────────────────────────────────────────
function showTypingIndicator() {
  document.getElementById('typingIndicator').classList.remove('hidden');
  if (state.shouldAutoScroll) scrollToBottom();
}

function hideTypingIndicator() {
  document.getElementById('typingIndicator').classList.add('hidden');
}

// ── Status ────────────────────────────────────────────────────
function setStatus(state_) {
  const pill = document.getElementById('statusPill');
  const text = document.getElementById('statusText');
  if (state_ === 'thinking') {
    pill.classList.add('thinking');
    text.textContent = 'Thinking…';
  } else {
    pill.classList.remove('thinking');
    text.textContent = 'Online';
  }
}

// ── Scroll ────────────────────────────────────────────────────
function scrollToBottom(force = false) {
  const container = document.getElementById('messagesContainer');
  if (force || state.shouldAutoScroll) {
    container.scrollTop = container.scrollHeight;
  }
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  requestAnimationFrame(() => toast.classList.add('show'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2500);
}

// ── Utilities ─────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Keyboard Shortcuts ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Ctrl+/ or Cmd+/ to focus input
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    document.getElementById('messageInput').focus();
  }
  // Escape to close modals
  if (e.key === 'Escape') {
    document.getElementById('apiKeyModal').classList.add('hidden');
    document.getElementById('renameModal').classList.add('hidden');
  }
  // Ctrl+K for new chat
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    newChat();
  }
});

// Focus input on load
setTimeout(() => {
  document.getElementById('messageInput')?.focus();
}, 500);

// ═══════════════════════════════════════════════════════════════
//  ANIMATED BACKGROUND — Futuristic Neural Grid Canvas
//  Three layered systems: drifting grid, particle nodes, energy beams
// ═══════════════════════════════════════════════════════════════
(function initBackground() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // ── Palette ──────────────────────────────────────────────────
  const PINK      = 'rgba(249,168,212,';
  const PINK_BLUE = 'rgba(180,160,255,';
  const CYAN      = 'rgba(100,200,255,';

  // ── Resize ───────────────────────────────────────────────────
  let W, H;
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', () => { resize(); rebuildSystems(); });
  resize();

  // ══════════════════════════════════════════════════════════════
  //  SYSTEM 1 — Perspective Grid (slow drift + pulse)
  // ══════════════════════════════════════════════════════════════
  const grid = {
    offsetY: 0,
    speed: 0.25,
    cols: 14,
    rows: 22,
    vanishX: 0,
    vanishY: 0,

    init() {
      this.vanishX = W * 0.5;
      this.vanishY = H * 0.38;
    },

    draw(t) {
      this.offsetY = (this.offsetY + this.speed) % (H / this.rows);
      this.vanishX = W * 0.5 + Math.sin(t * 0.0003) * W * 0.04;

      const alpha = 0.18;
      const horizonY = this.vanishY;

      // Horizontal lines
      for (let r = 0; r <= this.rows; r++) {
        const y = horizonY + (r / this.rows) * (H - horizonY) + this.offsetY;
        if (y < horizonY || y > H + 4) continue;
        const progress = (y - horizonY) / (H - horizonY);
        const fade = Math.pow(progress, 0.6) * alpha;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.strokeStyle = PINK + fade + ')';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Vertical perspective lines fanning from vanish point
      for (let c = 0; c <= this.cols; c++) {
        const xBottom = (c / this.cols) * W;
        const progress = (c / this.cols - 0.5) * 2; // -1 to 1
        const fade = (1 - Math.abs(progress) * 0.5) * alpha * 0.8;

        ctx.beginPath();
        ctx.moveTo(this.vanishX, horizonY);
        ctx.lineTo(xBottom, H);
        ctx.strokeStyle = PINK + fade + ')';
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }

      // Horizon glow line
      const grad = ctx.createLinearGradient(0, horizonY, W, horizonY);
      grad.addColorStop(0,   PINK + '0)');
      grad.addColorStop(0.3, PINK + '0.25)');
      grad.addColorStop(0.5, PINK + '0.5)');
      grad.addColorStop(0.7, PINK + '0.25)');
      grad.addColorStop(1,   PINK + '0)');
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(W, horizonY);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // ══════════════════════════════════════════════════════════════
  //  SYSTEM 2 — Floating Particle Nodes with connection lines
  // ══════════════════════════════════════════════════════════════
  const NODE_COUNT = Math.min(55, Math.floor((W * H) / 22000));
  const CONNECT_DIST = 160;
  let nodes = [];

  function createNode() {
    return {
      x:    Math.random() * W,
      y:    Math.random() * H,
      vx:   (Math.random() - 0.5) * 0.4,
      vy:   (Math.random() - 0.5) * 0.3,
      r:    Math.random() * 1.6 + 0.6,
      // Randomly assign color family
      col:  Math.random() > 0.6 ? PINK : Math.random() > 0.5 ? PINK_BLUE : CYAN,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.01 + Math.random() * 0.015,
    };
  }

  function buildNodes() {
    nodes = [];
    const count = Math.min(55, Math.floor((W * H) / 22000));
    for (let i = 0; i < count; i++) nodes.push(createNode());
  }

  function drawNodes(t) {
    // Update positions
    for (const n of nodes) {
      n.x  += n.vx;
      n.y  += n.vy;
      n.pulse += n.pulseSpeed;

      // Wrap around
      if (n.x < -10) n.x = W + 10;
      if (n.x > W + 10) n.x = -10;
      if (n.y < -10) n.y = H + 10;
      if (n.y > H + 10) n.y = -10;
    }

    // Draw connections
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > CONNECT_DIST) continue;

        const alpha = (1 - dist / CONNECT_DIST) * 0.18;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.strokeStyle = nodes[i].col + alpha + ')';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Draw nodes
    for (const n of nodes) {
      const pulse = 0.5 + Math.sin(n.pulse) * 0.5;
      const alpha = 0.3 + pulse * 0.5;
      const radius = n.r * (0.85 + pulse * 0.3);

      // Outer glow
      const glowGrad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, radius * 5);
      glowGrad.addColorStop(0, n.col + (alpha * 0.25) + ')');
      glowGrad.addColorStop(1, n.col + '0)');
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius * 5, 0, Math.PI * 2);
      ctx.fillStyle = glowGrad;
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = n.col + alpha + ')';
      ctx.fill();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SYSTEM 3 — Slow energy beams / scan lines (horizontal)
  // ══════════════════════════════════════════════════════════════
  let beams = [];

  function createBeam() {
    return {
      y:      Math.random() * H,
      speed:  0.15 + Math.random() * 0.35,
      width:  60 + Math.random() * 160,
      alpha:  0.04 + Math.random() * 0.08,
      col:    Math.random() > 0.5 ? PINK : CYAN,
      dir:    Math.random() > 0.5 ? 1 : -1,
    };
  }

  function buildBeams() {
    beams = [];
    for (let i = 0; i < 5; i++) beams.push(createBeam());
  }

  function drawBeams() {
    for (const b of beams) {
      b.y += b.speed * b.dir;
      if (b.y < -b.width) b.y = H + b.width;
      if (b.y > H + b.width) b.y = -b.width;

      const grad = ctx.createLinearGradient(0, b.y - b.width/2, 0, b.y + b.width/2);
      grad.addColorStop(0,   b.col + '0)');
      grad.addColorStop(0.5, b.col + b.alpha + ')');
      grad.addColorStop(1,   b.col + '0)');

      ctx.fillStyle = grad;
      ctx.fillRect(0, b.y - b.width/2, W, b.width);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SYSTEM 4 — Corner vignette + ambient radial glow
  // ══════════════════════════════════════════════════════════════
  function drawAmbience(t) {
    // Breathing central radial glow
    const breathe = 0.5 + Math.sin(t * 0.0008) * 0.15;
    const cx = W * 0.5, cy = H * 0.5;
    const r = Math.max(W, H) * 0.7;

    const grad = ctx.createRadialGradient(cx, cy * 0.6, 0, cx, cy * 0.6, r);
    grad.addColorStop(0,   `rgba(249,168,212,${0.04 * breathe})`);
    grad.addColorStop(0.4, `rgba(140,100,200,${0.03 * breathe})`);
    grad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Deep vignette corners
    const vig = ctx.createRadialGradient(cx, cy, H * 0.3, cx, cy, H * 1.2);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Rebuild all dynamic systems on resize ────────────────────
  function rebuildSystems() {
    grid.init();
    buildNodes();
    buildBeams();
  }
  rebuildSystems();

  // ── Main render loop ─────────────────────────────────────────
  let raf;
  function render(t) {
    ctx.clearRect(0, 0, W, H);

    // Base deep background
    ctx.fillStyle = '#07070d';
    ctx.fillRect(0, 0, W, H);

    drawAmbience(t);
    grid.draw(t);
    drawBeams();
    drawNodes(t);

    raf = requestAnimationFrame(render);
  }

  raf = requestAnimationFrame(render);

  // Pause when tab is hidden to save resources
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else raf = requestAnimationFrame(render);
  });
})();