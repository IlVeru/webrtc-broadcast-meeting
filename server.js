const express = require('express');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const port = 8080;

const options = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
};

app.use(express.static(path.join(__dirname, 'public')));

const server = https.createServer(options, app);
const io = new Server(server);

// Logika Signaling
io.on('connection', (socket) => {
  console.log('User terhubung:', socket.id);

  // Broadcaster bergabung ke room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`Broadcaster ${socket.id} membuat/bergabung ke room ${roomId}`);
  });

  // Viewer bergabung ke room
  socket.on('join-as-viewer', (roomId) => {
    socket.join(roomId);
    console.log(`Viewer ${socket.id} bergabung ke room ${roomId}`);
    // Beri tahu broadcaster bahwa ada viewer baru
    socket.to(roomId).emit('viewer-joined', { viewerId: socket.id });
  });

  // Relay offer dari broadcaster ke viewer
  socket.on('offer', (payload) => {
    io.to(payload.target).emit('offer', {
      sdp: payload.sdp,
      broadcasterId: socket.id
    });
  });

  // Relay answer dari viewer ke broadcaster
  socket.on('answer', (payload) => {
    io.to(payload.target).emit('answer', {
      sdp: payload.sdp,
      viewerId: socket.id
    });
  });

  // Relay ICE candidates
  socket.on('ice-candidate', (payload) => {
    socket.to(payload.roomId).emit('ice-candidate', {
      candidate: payload.candidate,
      senderId: socket.id
    });
  });

  // ==========================================
  // FITUR VIDEO MEETING / CONFERENCE (MULTI-USER)
  // ==========================================
  socket.on('join-meeting', ({ roomId, userName }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName || 'User';

    // Dapatkan semua user lain yang sudah ada di room
    const clientsInRoom = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
      .filter(id => id !== socket.id)
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return { socketId: id, userName: s ? s.userName : 'User' };
      });

    // Kirim daftar user yang sudah ada ke user baru
    socket.emit('meeting-users', clientsInRoom);

    // Beritahu user lain bahwa ada anggota baru bergabung
    socket.to(roomId).emit('user-joined-meeting', {
      socketId: socket.id,
      userName: socket.userName
    });

    console.log(`Meeting: ${socket.userName} (${socket.id}) bergabung ke room ${roomId}`);
  });

  // Relay sinyal WebRTC meeting antar peer langsung (1-to-1 signaling)
  socket.on('meeting-signal', ({ target, signal, type }) => {
    io.to(target).emit('meeting-signal', {
      sender: socket.id,
      userName: socket.userName,
      signal,
      type
    });
  });

  socket.on('disconnect', () => {
    console.log('User terputus:', socket.id);
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-left-meeting', { socketId: socket.id });
    }
  });
});

// Dapatkan IP lokal dari antarmuka jaringan (bukan loopback)
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Listen pada 0.0.0.0 agar bisa diakses via IP (Percobaan 2: antar komputer)
server.listen(port, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('==============================================');
  console.log('  WebRTC Broadcast Server Berjalan!');
  console.log('==============================================');
  console.log(`  Lokal (localhost) : https://localhost:${port}`);
  console.log(`  Via IP (jaringan) : https://${localIP}:${port}`);
  console.log('----------------------------------------------');
  console.log(`  Broadcaster : https://${localIP}:${port}/`);
  console.log(`  Viewer      : https://${localIP}:${port}/viewer.html`);
  console.log(`  Meeting     : https://${localIP}:${port}/meeting.html`);
  console.log('==============================================');
  console.log('');
});
