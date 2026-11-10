// app-meeting.js - Logika Video Conference Multi-Peer (Full Mesh WebRTC)

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const socket = io();
let localStream = null;
let currentRoomId = null;
let myName = 'Anda';

// Map untuk menyimpan RTCPeerConnection tiap peer: { [socketId]: RTCPeerConnection }
const peers = {};

// Elemen DOM
const lobbyModal = document.getElementById('lobbyModal');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');

const localVideo = document.getElementById('localVideo');
const localNameLabel = document.getElementById('localNameLabel');
const roomBadge = document.getElementById('roomBadge');
const participantCount = document.getElementById('participantCount');
const videoGrid = document.getElementById('videoGrid');

const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const leaveBtn = document.getElementById('leaveBtn');

let isAudioMuted = false;
let isVideoStopped = false;

// Default nama acak jika kosong
nameInput.value = 'User-' + Math.floor(1000 + Math.random() * 9000);

// 1. Tombol Join Meeting
joinBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim() || 'User';
  const roomId = roomInput.value.trim() || 'room-meeting';

  myName = name;
  currentRoomId = roomId;
  localNameLabel.textContent = `${name} (Anda)`;
  roomBadge.textContent = `Room: ${roomId}`;

  try {
    // Dapatkan media stream lokal (audio & video)
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    localVideo.srcObject = localStream;

    // Sembunyikan lobby
    lobbyModal.style.display = 'none';

    // Beritahu server bergabung ke room
    socket.emit('join-meeting', { roomId, userName: myName });
  } catch (err) {
    alert('Gagal mengakses kamera/mikrofon: ' + err.message);
  }
});

// 2. Server mengirimkan daftar peserta yang sudah ada di room saat kita baru join
socket.on('meeting-users', async (existingUsers) => {
  updateCount();
  // Untuk setiap user yang sudah ada duluan, buat WebRTC Offer ke mereka
  for (const user of existingUsers) {
    createPeerConnection(user.socketId, user.userName, true);
  }
});

// 3. Peserta baru bergabung ke room kita
socket.on('user-joined-meeting', ({ socketId, userName }) => {
  updateCount();
  // Siapkan peer connection, menunggu offer dari user baru tersebut
  createPeerConnection(socketId, userName, false);
});

// 4. Menerima sinyal (Offer, Answer, ICE Candidate)
socket.on('meeting-signal', async ({ sender, userName, signal, type }) => {
  let pc = peers[sender];

  if (!pc) {
    pc = createPeerConnection(sender, userName, false);
  }

  try {
    if (type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('meeting-signal', {
        target: sender,
        signal: answer,
        type: 'answer'
      });
    } else if (type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (type === 'candidate') {
      if (signal) {
        await pc.addIceCandidate(new RTCIceCandidate(signal));
      }
    }
  } catch (err) {
    console.error('Error saat handling signal:', err);
  }
});

// 5. Peserta keluar room
socket.on('user-left-meeting', ({ socketId }) => {
  removePeer(socketId);
  updateCount();
});

// Fungsi Membuat RTCPeerConnection per user
function createPeerConnection(targetSocketId, targetUserName, isInitiator) {
  if (peers[targetSocketId]) return peers[targetSocketId];

  const pc = new RTCPeerConnection(config);
  peers[targetSocketId] = pc;

  // Tambahkan local stream tracks ke koneksi
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Kirim ICE Candidate ke peer
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('meeting-signal', {
        target: targetSocketId,
        signal: event.candidate,
        type: 'candidate'
      });
    }
  };

  // Terima Remote Track dari peserta lain
  pc.ontrack = (event) => {
    addRemoteVideo(targetSocketId, targetUserName, event.streams[0]);
  };

  // Jika kita yang initiate (user baru ke user yang ada di room), buat offer
  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit('meeting-signal', {
          target: targetSocketId,
          signal: offer,
          type: 'offer'
        });
      } catch (err) {
        console.error('Error membuat offer:', err);
      }
    };
  }

  return pc;
}

// Menambahkan elemen video peserta lain ke UI Grid
function addRemoteVideo(socketId, userName, stream) {
  let card = document.getElementById(`card-${socketId}`);
  if (!card) {
    card = document.createElement('div');
    card.className = 'video-card';
    card.id = `card-${socketId}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.innerHTML = `<span>👤</span><span>${userName || 'Peserta'}</span>`;

    card.appendChild(video);
    card.appendChild(label);
    videoGrid.appendChild(card);
  } else {
    const video = card.querySelector('video');
    if (video) video.srcObject = stream;
  }
  updateCount();
}

// Menghapus peserta saat disconnect
function removePeer(socketId) {
  if (peers[socketId]) {
    peers[socketId].close();
    delete peers[socketId];
  }
  const card = document.getElementById(`card-${socketId}`);
  if (card) card.remove();
  updateCount();
}

function updateCount() {
  const count = Object.keys(peers).length + 1;
  participantCount.textContent = count;
}

// Tombol Mute / Unmute Mic
micBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    isAudioMuted = !isAudioMuted;
    audioTrack.enabled = !isAudioMuted;
    micBtn.classList.toggle('off', isAudioMuted);
    micBtn.textContent = isAudioMuted ? '🔇' : '🎙️';
  }
});

// Tombol Nyalakan / Matikan Kamera
camBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    isVideoStopped = !isVideoStopped;
    videoTrack.enabled = !isVideoStopped;
    camBtn.classList.toggle('off', isVideoStopped);
    camBtn.textContent = isVideoStopped ? '🚫' : '📷';
  }
});

// Tombol Keluar
leaveBtn.addEventListener('click', () => {
  if (confirm('Keluar dari meeting?')) {
    window.location.reload();
  }
});

