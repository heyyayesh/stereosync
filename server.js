const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-Mime-Type, Range');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

let currentTrackBuffer = null;
let currentTrackMime = 'audio/mpeg';
let currentTrackName = 'track.mp3';

function getLocalWifiIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

app.get('/api/lan-info', (req, res) => {
  res.json({
    ip: getLocalWifiIp(),
    port: PORT,
    hasTrack: Boolean(currentTrackBuffer),
    trackName: currentTrackName
  });
});

app.post('/api/upload', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  if (!req.body || !req.body.length) {
    return res.status(400).json({ error: 'Empty audio file' });
  }
  currentTrackBuffer = req.body;
  currentTrackMime = req.headers['x-mime-type'] || 'audio/mpeg';
  currentTrackName = decodeURIComponent(req.headers['x-file-name'] || 'track.mp3');

  const streamUrl = `http://${getLocalWifiIp()}:${PORT}/api/stream?t=${Date.now()}`;
  console.log(`Loaded ${currentTrackName} (${(currentTrackBuffer.length / 1048576).toFixed(2)} MB) -> ${streamUrl}`);
  res.json({ streamUrl, name: currentTrackName, size: currentTrackBuffer.length });
});

app.get('/api/stream', (req, res) => {
  if (!currentTrackBuffer) return res.status(404).send('No track loaded');

  const total = currentTrackBuffer.length;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', currentTrackMime);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', chunkSize);
    res.end(currentTrackBuffer.subarray(start, end + 1));
  } else {
    res.status(200);
    res.setHeader('Content-Length', total);
    res.end(currentTrackBuffer);
  }
});

let roomState = {
  mode: 'LOCAL',
  videoId: 'jfKfPfyJRdk',
  isPlaying: false,
  trackPosition: 0,
  updatedAt: Date.now()
};

io.on('connection', (socket) => {
  socket.emit('state_sync', roomState);

  socket.on('ntp_ping', (clientSendTime) => {
    socket.emit('ntp_pong', { clientSendTime, serverTime: Date.now() });
  });

  socket.on('update_state', (newState) => {
    roomState = { ...roomState, ...newState, updatedAt: Date.now() };
    io.emit('state_sync', roomState);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Stereo Sync Server ready at http://${getLocalWifiIp()}:${PORT}`);
});
