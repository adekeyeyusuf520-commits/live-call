require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const MAX_PARTICIPANTS = 10;
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new Map();
const userSocketMap = new Map();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });

  const users = readJson(USERS_FILE);
  if (users.find((u) => u.email === email)) return res.status(409).json({ error: 'Email already in use' });

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = { id: uuidv4(), email, name, passwordHash, createdAt: new Date().toISOString() };
  users.push(newUser);
  writeJson(USERS_FILE, users);

  res.status(201).json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const users = readJson(USERS_FILE);
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/history', authMiddleware, (req, res) => {
  const history = readJson(HISTORY_FILE);
  const own = history.filter((h) => h.participants.some((p) => p.id === req.user.id));
  res.json(own);
});

app.post('/api/call/invite', authMiddleware, (req, res) => {
  const { roomId } = req.body;
  const inviteLink = `${req.protocol}://${req.get('host')}/call.html?room=${roomId || uuidv4()}`;
  res.json({ inviteLink });
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

function emitRoomUpdate(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  io.to(roomId).emit('participants:update', Array.from(room.participants.values()));
}

function logCallEnd(roomId, room) {
  const history = readJson(HISTORY_FILE);
  history.unshift({
    id: uuidv4(),
    roomId,
    startedAt: room.createdAt,
    endedAt: new Date().toISOString(),
    participants: Array.from(room.participants.values()).map((p) => ({ id: p.userId, name: p.name, email: p.email })),
    recordingConsent: Array.from(room.recordingConsent.entries()).map(([k, v]) => ({ userId: k, consent: v }))
  });
  writeJson(HISTORY_FILE, history.slice(0, 2000));
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));

  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const currentUser = socket.user;
  userSocketMap.set(currentUser.id, socket.id);

  socket.on('room:join', ({ roomId }, cb) => {
    if (!roomId) return cb?.({ error: 'Missing room ID' });

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        hostId: currentUser.id,
        participants: new Map(),
        createdAt: new Date().toISOString(),
        recordingConsent: new Map()
      });
    }

    const room = rooms.get(roomId);
    if (room.participants.size >= MAX_PARTICIPANTS) return cb?.({ error: `Room limit reached (${MAX_PARTICIPANTS})` });

    room.participants.set(socket.id, {
      socketId: socket.id,
      userId: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      isHost: room.hostId === currentUser.id
    });
    socket.join(roomId);
    socket.data.roomId = roomId;

    const peers = Array.from(room.participants.values()).filter((p) => p.socketId !== socket.id);
    cb?.({ ok: true, roomId, peers, hostId: room.hostId });
    emitRoomUpdate(roomId);

    socket.to(roomId).emit('peer:joined', { socketId: socket.id, user: room.participants.get(socket.id) });
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('chat:message', ({ roomId, text, emoji, attachment }) => {
    io.to(roomId).emit('chat:message', {
      id: uuidv4(),
      from: { id: currentUser.id, name: currentUser.name },
      text,
      emoji,
      attachment,
      sentAt: new Date().toISOString()
    });
  });

  socket.on('recording:consent', ({ roomId, consent }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.recordingConsent.set(currentUser.id, Boolean(consent));
    io.to(roomId).emit('recording:consent:update', Array.from(room.recordingConsent.entries()));
  });

  socket.on('participant:kick', ({ roomId, targetSocketId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: 'Room not found' });

    const requester = room.participants.get(socket.id);
    if (!requester?.isHost) return cb?.({ error: 'Only host can kick participants' });

    if (room.participants.has(targetSocketId)) {
      io.to(targetSocketId).emit('participant:kicked');
      io.sockets.sockets.get(targetSocketId)?.leave(roomId);
      room.participants.delete(targetSocketId);
      emitRoomUpdate(roomId);
      cb?.({ ok: true });
    } else {
      cb?.({ error: 'Participant not found' });
    }
  });

  socket.on('disconnect', () => {
    userSocketMap.delete(currentUser.id);

    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    room.participants.delete(socket.id);
    socket.to(roomId).emit('peer:left', { socketId: socket.id });

    if (!room.participants.size) {
      logCallEnd(roomId, room);
      rooms.delete(roomId);
      return;
    }

    if (room.hostId === currentUser.id) {
      const nextHost = room.participants.values().next().value;
      room.hostId = nextHost.userId;
      nextHost.isHost = true;
      io.to(roomId).emit('host:changed', { hostId: room.hostId, hostSocketId: nextHost.socketId });
    }

    emitRoomUpdate(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`LiveCall server running on http://localhost:${PORT}`);
});
