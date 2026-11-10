// dual-browser.js - Logika Percobaan 1: Browser 1 (Google Chrome - Broadcaster)
// Menangani siaran video lokal (webcam/pola uji) dan melayani viewer yang bergabung

const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// Elemen DOM Browser 1 (Broadcaster)
const b1Video = document.getElementById('b1Video');
const b1TokenDisplay = document.getElementById('b1Token');
const b1StatusBadge = document.getElementById('b1StatusBadge');
const b1StatusText = document.getElementById('b1StatusText');
const b1SourceSelect = document.getElementById('b1SourceSelect');
const b1MicBtn = document.getElementById('b1MicBtn');
const b1CamBtn = document.getElementById('b1CamBtn');
const b1CopyBtn = document.getElementById('b1CopyBtn');
const b1StartBtn = document.getElementById('b1StartBtn');

// Elemen Global
const consoleBox = document.getElementById('consoleBox');
const resetBtn = document.getElementById('resetBtn');

// State Broadcaster
let b1Socket = null;
let b1Stream = null;
let b1RoomId = null;
const b1PeerConnections = {};

// ==========================================================================
// SYSTEM LOGGING & TIMELINE
// ==========================================================================
function log(tagClass, tagText, message) {
  if (!consoleBox) return;
  const now = new Date();
  const time = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-tag ${tagClass}">${tagText}</span>
    <span class="log-msg">${message}</span>
  `;
  consoleBox.appendChild(entry);
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

function updateStep(stepNum, status = 'active') {
  const stepEl = document.getElementById(`step${stepNum}`);
  if (!stepEl) return;
  stepEl.classList.remove('active', 'success');
  if (status !== 'idle') {
    stepEl.classList.add(status);
  }
}

function showToast(msg) {
  const toast = document.getElementById('toastAlert');
  const toastMsg = document.getElementById('toastMsg');
  if (toast && toastMsg) {
    toastMsg.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

// ==========================================================================
// DYNAMIC TEST PATTERN GENERATOR (Fallback jika webcam mati / sibuk)
// ==========================================================================
function createTestPatternStream(label = "BROADCASTER 1 (SIMULASI)") {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  let frame = 0;
  function draw() {
    frame++;
    // Gradient Background
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#090d16');
    grad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // SMPTE Color Bars
    const colors = ['#ffffff', '#facc15', '#06b6d4', '#22c55e', '#ec4899', '#ef4444', '#3b82f6'];
    const barWidth = canvas.width / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(i * barWidth, 380, barWidth, 100);
    });

    // Moving dynamic pulse ball (visual 60fps proof)
    const x = canvas.width / 2 + Math.cos(frame * 0.05) * 190;
    const y = 200 + Math.sin(frame * 0.08) * 55;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fillStyle = '#6366f1';
    ctx.shadowColor = '#818cf8';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Header Tag
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(canvas.width / 2 - 130, 28, 260, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔴 PERCOBAAN 1 • BROADCASTER', canvas.width / 2, 48);

    // Live Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, canvas.width / 2, 95);

    // Digital Millisecond Clock
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    ctx.font = 'bold 36px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(timeStr, canvas.width / 2, 145);

    // Metadata details
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('FPS: 30 | WebRTC Video Stream | Google Chrome', canvas.width / 2, 335);

    requestAnimationFrame(draw);
  }
  draw();

  const stream = canvas.captureStream(30);

  // Audio tone track
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) {
      stream.addTrack(audioTrack);
    }
  } catch (err) {
    console.warn('AudioContext notice:', err);
  }

  return stream;
}

// ==========================================================================
// BROWSER 1: LOGIKA BROADCASTER
// ==========================================================================
async function initBrowser1() {
  if (b1Socket) return;

  log('tag-b1', 'Browser 1', 'Menghubungkan ke server signaling Socket.IO...');
  b1Socket = io({ forceNew: true, multiplex: false });

  b1Socket.on('connect', () => {
    log('tag-b1', 'Browser 1', `Terhubung ke server Socket.IO (ID: ${b1Socket.id})`);
    if (b1StatusBadge) b1StatusBadge.className = 'status-pill ready';
    if (b1StatusText) b1StatusText.innerText = 'Siap Siaran';
  });

  // Listener ketika ada viewer bergabung
  b1Socket.on('viewer-joined', async ({ viewerId }) => {
    log('tag-server', 'Signaling', `Viewer ${viewerId} bergabung ke room! Menyiapkan koneksi WebRTC...`);
    updateStep(2, 'success');
    updateStep(3, 'active');

    const pc = new RTCPeerConnection(config);
    b1PeerConnections[viewerId] = pc;

    if (b1Stream) {
      b1Stream.getTracks().forEach(track => pc.addTrack(track, b1Stream));
    }

    pc.onicecandidate = event => {
      if (event.candidate) {
        log('tag-b1', 'Browser 1', `Mengirim ICE Candidate ke viewer ${viewerId}`);
        b1Socket.emit('ice-candidate', { roomId: b1RoomId, candidate: event.candidate });
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      b1Socket.emit('offer', { target: viewerId, sdp: offer });
      log('tag-b1', 'Browser 1', `SDP Offer terkirim ke target Viewer (${viewerId})`);
      updateStep(3, 'success');
      updateStep(4, 'active');
    } catch (err) {
      log('tag-b1', 'Browser 1 Error', `Gagal membuat offer: ${err.message}`);
    }
  });

  // Listener menerima SDP Answer dari viewer
  b1Socket.on('answer', async ({ sdp, viewerId }) => {
    log('tag-b1', 'Browser 1', `Menerima SDP Answer dari Viewer ${viewerId}`);
    updateStep(4, 'success');
    updateStep(5, 'active');

    const pc = b1PeerConnections[viewerId];
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        log('tag-webrtc', 'WebRTC', `Koneksi P2P Berhasil! Streaming video terhubung dengan Viewer ${viewerId}`);
        updateStep(5, 'success');
        updateStep(6, 'success');
        showToast(`Viewer ${viewerId} terhubung ke siaran Anda!`);
      } catch (err) {
        console.error('B1 setRemoteDescription error:', err);
      }
    }
  });

  // Listener menerima ICE Candidate
  b1Socket.on('ice-candidate', async ({ candidate, senderId }) => {
    if (senderId !== b1Socket.id) {
      const pc = b1PeerConnections[senderId];
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          log('tag-b1', 'Browser 1', `ICE Candidate dari ${senderId} ditambahkan`);
        } catch (err) {
          console.error('B1 addIceCandidate error:', err);
        }
      }
    }
  });
}

async function startBroadcastOnB1() {
  await initBrowser1();

  // Generate Room ID
  b1RoomId = Math.random().toString(36).substring(2, 10);
  if (b1TokenDisplay) b1TokenDisplay.innerText = b1RoomId;
  log('tag-b1', 'Browser 1', `Membuat Room ID: ${b1RoomId}`);
  b1Socket.emit('join-room', b1RoomId);
  updateStep(1, 'success');
  updateStep(2, 'active');

  // Ambil Media Stream
  const sourceMode = b1SourceSelect ? b1SourceSelect.value : 'webcam';
  if (sourceMode === 'canvas') {
    log('tag-b1', 'Browser 1', 'Menggunakan Dynamic Test Pattern Generator (Pola Uji Dinamis)');
    b1Stream = createTestPatternStream("KAMERA BROWSER 1 (GOOGLE CHROME)");
    if (b1Video) b1Video.srcObject = b1Stream;
    if (b1StatusBadge) b1StatusBadge.className = 'status-pill live';
    if (b1StatusText) b1StatusText.innerText = 'ON-AIR (Test Pattern)';
  } else {
    try {
      log('tag-b1', 'Browser 1', 'Membuka kamera & mikrofon laptop...');
      b1Stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (b1Video) b1Video.srcObject = b1Stream;
      if (b1StatusBadge) b1StatusBadge.className = 'status-pill live';
      if (b1StatusText) b1StatusText.innerText = 'ON-AIR (Webcam Aktif)';
      log('tag-b1', 'Browser 1', 'Kamera & mikrofon berhasil diaktifkan!');
    } catch (err) {
      log('tag-b1', 'Browser 1 Info', `Webcam fisik tidak dapat diakses (${err.name}). Beralih otomatis ke Test Pattern Generator.`);
      if (b1SourceSelect) b1SourceSelect.value = 'canvas';
      b1Stream = createTestPatternStream("KAMERA BROWSER 1 (SIMULASI)");
      if (b1Video) b1Video.srcObject = b1Stream;
      if (b1StatusBadge) b1StatusBadge.className = 'status-pill live';
      if (b1StatusText) b1StatusText.innerText = 'ON-AIR (Simulasi Aktif)';
    }
  }

  if (b1StartBtn) {
    b1StartBtn.innerHTML = '<span>🔄</span> Ganti Token / Reset Siaran';
  }

  showToast(`Siaran aktif! Token: ${b1RoomId}. Salin token untuk penonton.`);
}

// Reset Function
function resetSession() {
  log('tag-info', 'System', 'Mengatur ulang sesi siaran...');

  if (b1Stream) {
    b1Stream.getTracks().forEach(t => t.stop());
    b1Stream = null;
  }
  Object.values(b1PeerConnections).forEach(pc => pc.close());
  for (const k in b1PeerConnections) delete b1PeerConnections[k];
  if (b1Socket) {
    b1Socket.disconnect();
    b1Socket = null;
  }
  if (b1Video) b1Video.srcObject = null;
  b1RoomId = null;
  if (b1TokenDisplay) b1TokenDisplay.innerText = 'Belum Dibuat';
  if (b1StatusBadge) b1StatusBadge.className = 'status-pill ready';
  if (b1StatusText) b1StatusText.innerText = 'Siap Memulai';
  if (b1StartBtn) b1StartBtn.innerHTML = '<span>🚀</span> Mulai Siaran';

  for (let i = 1; i <= 6; i++) {
    updateStep(i, 'idle');
  }

  showToast('Sesi siaran berhasil di-reset.');
}

// ==========================================================================
// EVENT LISTENERS
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  if (resetBtn) resetBtn.addEventListener('click', resetSession);
  if (b1StartBtn) b1StartBtn.addEventListener('click', startBroadcastOnB1);

  if (b1CopyBtn) {
    b1CopyBtn.addEventListener('click', () => {
      if (b1RoomId) {
        navigator.clipboard.writeText(b1RoomId);
        showToast(`Token [${b1RoomId}] disalin ke clipboard! Buka di browser kedua.`);
      } else {
        showToast('Mulai siaran terlebih dahulu untuk mendapatkan token!');
      }
    });
  }

  if (b1SourceSelect) {
    b1SourceSelect.addEventListener('change', () => {
      if (b1RoomId) {
        showToast('Mengganti sumber video... Memperbarui siaran.');
        startBroadcastOnB1();
      }
    });
  }

  if (b1MicBtn) {
    b1MicBtn.addEventListener('click', () => {
      if (b1Stream) {
        const audioTracks = b1Stream.getAudioTracks();
        if (audioTracks.length > 0) {
          const enabled = !audioTracks[0].enabled;
          audioTracks[0].enabled = enabled;
          b1MicBtn.classList.toggle('active-danger', !enabled);
          document.getElementById('b1MicText').innerText = enabled ? 'Mute Mic' : 'Unmute Mic';
          document.getElementById('b1MicIcon').innerText = enabled ? '🎤' : '🔇';
          showToast(enabled ? 'Mikrofon Aktif' : 'Mikrofon Dibisukan');
        }
      }
    });
  }

  if (b1CamBtn) {
    b1CamBtn.addEventListener('click', () => {
      if (b1Stream) {
        const videoTracks = b1Stream.getVideoTracks();
        if (videoTracks.length > 0) {
          const enabled = !videoTracks[0].enabled;
          videoTracks[0].enabled = enabled;
          b1CamBtn.classList.toggle('active-danger', !enabled);
          document.getElementById('b1CamText').innerText = enabled ? 'Stop Video' : 'Start Video';
          document.getElementById('b1CamIcon').innerText = enabled ? '📷' : '🚫';
          showToast(enabled ? 'Kamera Aktif' : 'Kamera Dimatikan');
        }
      }
    });
  }

  const clearLogBtn = document.getElementById('clearLogBtn');
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      if (consoleBox) consoleBox.innerHTML = '';
      log('tag-info', 'Console', 'Log dibersihkan.');
    });
  }

  // Pesan inisialisasi awal
  log('tag-info', 'Sistem', 'Halaman Percobaan 1: Browser 1 (Broadcaster) siap. Klik "Mulai Siaran" untuk membuka kamera & membuat token.');
});
