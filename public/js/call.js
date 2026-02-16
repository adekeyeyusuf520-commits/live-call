const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
const token = localStorage.getItem('livecall_token');
if (!token || !roomId) window.location.href = '/';

const socket = io({ auth: { token } });
const peers = new Map();
const remoteStreams = new Map();

const videoGrid = document.getElementById('video-grid');
const participantsList = document.getElementById('participants');
const chatBox = document.getElementById('chat-box');
const chatForm = document.getElementById('chat-form');
const networkStatus = document.getElementById('network-status');

const audioBtn = document.getElementById('toggle-audio');
const videoBtn = document.getElementById('toggle-video');
const switchCameraBtn = document.getElementById('switch-camera');
const shareBtn = document.getElementById('share-screen');
const stopShareBtn = document.getElementById('stop-share');
const blurBtn = document.getElementById('toggle-blur');
const recordBtn = document.getElementById('record');
const leaveBtn = document.getElementById('leave');

let localStream;
let screenStream;
let currentFacingMode = 'user';
let isAudioMuted = false;
let isVideoMuted = false;
let mediaRecorder;
let recordingChunks = [];

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function addVideoTile(stream, id, label, isLocal = false) {
  const existing = document.getElementById(`video-${id}`);
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.className = 'video-wrap';
  wrap.id = `video-${id}`;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;

  const badge = document.createElement('span');
  badge.className = 'video-label';
  badge.textContent = label;

  wrap.appendChild(video);
  wrap.appendChild(badge);
  videoGrid.appendChild(wrap);
}

function updateParticipants(list) {
  const mySocketId = socket.id;
  participantsList.innerHTML = list.map((p) => {
    const kickBtn = p.socketId !== mySocketId ? `<button data-kick="${p.socketId}">Kick</button>` : '';
    return `<li>${p.name}${p.isHost ? ' (Host)' : ''} ${kickBtn}</li>`;
  }).join('');

  participantsList.querySelectorAll('[data-kick]').forEach((btn) => {
    btn.addEventListener('click', () => socket.emit('participant:kick', { roomId, targetSocketId: btn.dataset.kick }));
  });
}

function addChatMessage(entry) {
  const item = document.createElement('div');
  item.className = 'chat-item';
  let html = `<strong>${entry.from.name}:</strong> ${entry.text || ''} ${entry.emoji || ''}`;

  if (entry.attachment?.name && entry.attachment?.dataUrl) {
    html += ` <a href="${entry.attachment.dataUrl}" download="${entry.attachment.name}">📎 ${entry.attachment.name}</a>`;
  }

  html += `<small>${new Date(entry.sentAt || Date.now()).toLocaleTimeString()}</small>`;
  item.innerHTML = html;
  chatBox.appendChild(item);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function getMedia(facingMode = 'user') {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
}

function createPeerConnection(peerSocketId) {
  const pc = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    remoteStreams.set(peerSocketId, stream);
    addVideoTile(stream, peerSocketId, `Peer ${peerSocketId.slice(0, 4)}`);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { to: peerSocketId, data: { candidate: event.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected'].includes(pc.connectionState)) {
      document.getElementById(`video-${peerSocketId}`)?.remove();
      peers.delete(peerSocketId);
    }
  };

  peers.set(peerSocketId, pc);
  return pc;
}

async function callPeer(peerSocketId, isOfferer = true) {
  const pc = peers.get(peerSocketId) || createPeerConnection(peerSocketId);

  if (isOfferer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peerSocketId, data: { sdp: pc.localDescription } });
  }
}

socket.on('connect', async () => {
  localStream = await getMedia(currentFacingMode);
  addVideoTile(localStream, 'local', 'You', true);

  socket.emit('room:join', { roomId }, async (result) => {
    if (result?.error) {
      alert(result.error);
      window.location.href = '/';
      return;
    }

    for (const peer of result.peers) {
      await callPeer(peer.socketId, true);
    }
  });
});

socket.on('peer:joined', async ({ socketId }) => {
  await callPeer(socketId, false);
});

socket.on('peer:left', ({ socketId }) => {
  peers.get(socketId)?.close();
  peers.delete(socketId);
  document.getElementById(`video-${socketId}`)?.remove();
});

socket.on('participants:update', updateParticipants);
socket.on('chat:message', addChatMessage);
socket.on('participant:kicked', () => {
  alert('You were removed by the host.');
  window.location.href = '/';
});

socket.on('signal', async ({ from, data }) => {
  const pc = peers.get(from) || createPeerConnection(from);

  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
    }
  }

  if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch {
      // ignore race candidate issues
    }
  }
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('chat-input').value;
  const emoji = document.getElementById('emoji-input').value;
  const file = document.getElementById('file-input').files[0];

  const payload = { roomId, text, emoji };
  if (file) {
    const dataUrl = await fileToDataUrl(file);
    payload.attachment = { name: file.name, type: file.type, dataUrl };
  }

  socket.emit('chat:message', payload);
  chatForm.reset();
});

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

audioBtn.addEventListener('click', () => {
  isAudioMuted = !isAudioMuted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !isAudioMuted));
  audioBtn.textContent = isAudioMuted ? 'Unmute' : 'Mute';
});

videoBtn.addEventListener('click', () => {
  isVideoMuted = !isVideoMuted;
  localStream.getVideoTracks().forEach((t) => (t.enabled = !isVideoMuted));
  videoBtn.textContent = isVideoMuted ? 'Video On' : 'Video Off';
});

switchCameraBtn.addEventListener('click', async () => {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  const newStream = await getMedia(currentFacingMode);
  replaceVideoTrack(newStream.getVideoTracks()[0]);
  localStream.getVideoTracks().forEach((t) => t.stop());
  localStream = new MediaStream([newStream.getVideoTracks()[0], ...localStream.getAudioTracks()]);
  addVideoTile(localStream, 'local', 'You', true);
});

shareBtn.addEventListener('click', async () => {
  screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  replaceVideoTrack(screenStream.getVideoTracks()[0]);
  addVideoTile(screenStream, 'local', 'You (Sharing)', true);
  screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
});

stopShareBtn.addEventListener('click', stopScreenShare);

async function stopScreenShare() {
  if (!screenStream) return;
  const cameraTrack = localStream.getVideoTracks()[0];
  replaceVideoTrack(cameraTrack);
  screenStream.getTracks().forEach((t) => t.stop());
  screenStream = null;
  addVideoTile(localStream, 'local', 'You', true);
}

function replaceVideoTrack(track) {
  peers.forEach((pc) => {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) sender.replaceTrack(track);
  });
}

blurBtn.addEventListener('click', () => {
  document.getElementById('video-local')?.classList.toggle('blur-bg');
});

recordBtn.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    recordBtn.textContent = 'Start Recording';
    socket.emit('recording:consent', { roomId, consent: false });
    return;
  }

  const consent = confirm('Do you consent to recording this call?');
  socket.emit('recording:consent', { roomId, consent });
  if (!consent) return;

  const mixed = new MediaStream([...localStream.getTracks()]);
  mediaRecorder = new MediaRecorder(mixed, { mimeType: 'video/webm;codecs=vp9,opus' });
  recordingChunks = [];

  mediaRecorder.ondataavailable = (e) => e.data.size && recordingChunks.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordingChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `livecall-${roomId}-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  mediaRecorder.start();
  recordBtn.textContent = 'Stop Recording';
});

leaveBtn.addEventListener('click', () => {
  window.location.href = '/';
});

window.addEventListener('beforeunload', () => socket.disconnect());

setInterval(async () => {
  try {
    const c = navigator.connection;
    if (c?.effectiveType) {
      networkStatus.textContent = `Network: ${c.effectiveType}, RTT ${c.rtt || 'n/a'}ms`;
      if (['slow-2g', '2g'].includes(c.effectiveType)) {
        localStream.getVideoTracks().forEach((t) => t.applyConstraints({ width: 640, height: 360, frameRate: 15 }));
      }
    }
  } catch {
    networkStatus.textContent = 'Network: monitoring unavailable';
  }
}, 5000);
