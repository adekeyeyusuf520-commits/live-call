# LiveCall — WebRTC Video Calling Web App

LiveCall is a full-stack video calling app built with **HTML5, CSS3, JavaScript, Node.js, Socket.io, and WebRTC**.
It supports one-on-one and small-group calls (target: up to **10 participants per room**).

## Features

- **Video & Audio Calling**
  - HD camera + microphone streaming via WebRTC peer-to-peer mesh
  - Mute/unmute microphone
  - Toggle camera on/off
  - Switch front/rear camera (mobile-capable devices)
- **In-Call Messaging**
  - Real-time text chat with emojis
  - Lightweight file attachments via base64 transfer (images/docs)
- **Screen Sharing**
  - Share display/window/tab with start/stop controls
- **Participant Management**
  - Invite users via shareable room links
  - Host controls: kick participants in group calls
- **Recording**
  - Browser-based recording with explicit user consent prompt
  - Download `.webm` recording locally
- **Virtual Background/Filter**
  - Local blur filter toggle as a virtual background effect
- **Security**
  - User authentication (register/login with JWT)
  - WebRTC DTLS-SRTP transport encryption for media channels
- **Call History/Logs**
  - Persists room call logs with participants and recording consent flags
- **Responsive UI**
  - Lobby and in-call layout for desktop and mobile
- **Notifications and Error Handling**
  - Alerts for kicked users, room full, auth errors
  - Basic network quality indicator and low-bandwidth adaptation

## Architecture

- **Backend**: Node.js + Express + Socket.io (`src/server.js`)
  - REST API for auth/history/invite
  - Socket signaling for SDP/ICE exchange and room events
  - In-memory room state with JSON persistence for users/call history
- **Frontend**: Static pages (`public/`)
  - `index.html`: login/register, create/join rooms, call history
  - `call.html`: video grid, controls, participant panel, chat panel
  - Vanilla JS WebRTC logic in `public/js/call.js`

## Source Code Structure

```text
live-call/
├── data/
│   ├── history.json
│   └── users.json
├── public/
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── call.js
│   │   └── lobby.js
│   ├── call.html
│   └── index.html
├── src/
│   └── server.js
├── package.json
└── README.md
```

## Setup Instructions

### Prerequisites
- Node.js 18+
- npm 9+

### Installation

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

### Run in Production Mode

```bash
npm start
```

The app will be available at:

- `http://localhost:3000`

### Environment Variables

Create a `.env` file in the root (optional):

```env
PORT=3000
JWT_SECRET=replace_with_a_long_random_secret
```

## Usage Guide

1. Open lobby (`/`) and register a new account.
2. Login using your credentials.
3. Create an invite link or enter room ID.
4. Share invite link with participants.
5. In call page (`/call.html?room=<id>`):
   - Mute/unmute audio
   - Turn video on/off
   - Switch camera
   - Share/stop screen
   - Send chat messages, emojis, and attachments
   - Toggle virtual blur background
   - Start/stop recording (with consent)
   - Kick users as host
6. End call by leaving; logs are added to call history.

## Scalability Notes (Initial 10 Participants)

- Current topology uses **WebRTC mesh**, practical for small groups.
- Max participants per room enforced at server level (`MAX_PARTICIPANTS = 10`).
- For larger rooms or better CPU/network efficiency, migrate media routing to an SFU (e.g., mediasoup, Janus, LiveKit).

## Cross-Browser Compatibility

- Tested architecture for modern Chrome/Edge/Firefox and Safari with WebRTC support.
- Some APIs (Network Information, camera switching behavior) may vary by browser/device.
- HTTPS is recommended in production for full media device capability.

## Production Hardening Recommendations

- Use HTTPS + secure cookies
- Add TURN servers for restrictive NAT/firewall environments
- Move persistence to PostgreSQL/Redis
- Implement OAuth providers and email invites
- Add moderation roles and stronger audit logs
- Use server-side recording pipeline for compliance-grade storage
- Add end-to-end encrypted chat payloads if required beyond transport-level protection

