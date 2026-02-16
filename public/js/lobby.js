const tokenKey = 'livecall_token';
const userKey = 'livecall_user';

const authStatus = document.getElementById('auth-status');
const authForm = document.getElementById('auth-form');
const registerBtn = document.getElementById('register-btn');
const roomInput = document.getElementById('room-id');
const createRoomBtn = document.getElementById('create-room-btn');
const joinBtn = document.getElementById('join-btn');
const inviteLinkInput = document.getElementById('invite-link');
const historyList = document.getElementById('history-list');

function getToken() {
  return localStorage.getItem(tokenKey);
}

function setStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.style.color = isError ? '#f87171' : '#38bdf8';
}

async function api(path, options = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    localStorage.setItem(tokenKey, data.token);
    localStorage.setItem(userKey, JSON.stringify(data.user));
    setStatus(`Logged in as ${data.user.name}`);
    await loadHistory();
  } catch (err) {
    setStatus(err.message, true);
  }
});

registerBtn.addEventListener('click', async () => {
  try {
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
    setStatus('Registration successful. Login now.');
  } catch (err) {
    setStatus(err.message, true);
  }
});

createRoomBtn.addEventListener('click', async () => {
  try {
    const roomId = roomInput.value || crypto.randomUUID();
    const data = await api('/api/call/invite', {
      method: 'POST',
      body: JSON.stringify({ roomId })
    });
    inviteLinkInput.value = data.inviteLink;
    roomInput.value = roomId;
  } catch (err) {
    setStatus(`Invite failed: ${err.message}`, true);
  }
});

joinBtn.addEventListener('click', () => {
  if (!getToken()) return setStatus('Please login first.', true);
  const room = roomInput.value || crypto.randomUUID();
  window.location.href = `/call.html?room=${encodeURIComponent(room)}`;
});

async function loadHistory() {
  if (!getToken()) return;
  try {
    const history = await api('/api/history');
    historyList.innerHTML = history.slice(0, 10).map((h) => {
      const participants = h.participants.map((p) => p.name).join(', ');
      return `<li>${new Date(h.startedAt).toLocaleString()} — Room ${h.roomId} (${participants})</li>`;
    }).join('') || '<li>No calls yet.</li>';
  } catch {
    historyList.innerHTML = '<li>Could not load call history.</li>';
  }
}

const cachedUser = localStorage.getItem(userKey);
if (cachedUser) {
  const user = JSON.parse(cachedUser);
  setStatus(`Welcome back, ${user.name}`);
}
loadHistory();
