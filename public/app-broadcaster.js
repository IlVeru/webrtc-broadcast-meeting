// app-broadcaster.js - Broadcaster: Support Kamera Langsung & File Video via WebRTC
const socket = io();
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const peerConnections = {};

// Elemen Tab & Panel
const tabCameraBtn = document.getElementById('tabCameraBtn');
const tabFileBtn = document.getElementById('tabFileBtn');
const cameraSourcePanel = document.getElementById('cameraSourcePanel');
const fileSourcePanel = document.getElementById('fileSourcePanel');

// Elemen Kamera
const cameraDeviceSelect = document.getElementById('cameraDeviceSelect');
const startCamBtn = document.getElementById('startCamBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const micIconText = document.getElementById('micIconText');

// Elemen File Video
const localVideo = document.getElementById('localVideo');
const tokenDisplay = document.getElementById('token');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const copyTokenBtn = document.getElementById('copyTokenBtn');
const viewerCountEl = document.getElementById('viewerCount');
const videoFileInput = document.getElementById('videoFileInput');
const pickFileBtn = document.getElementById('pickFileBtn');
const dropZone = document.getElementById('dropZone');
const fileInfo = document.getElementById('fileInfo');
const fileNameEl = document.getElementById('fileName');
const fileSizeEl = document.getElementById('fileSize');
const startBroadcastBtn = document.getElementById('startBroadcastBtn');
const stopBroadcastBtn = document.getElementById('stopBroadcastBtn');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const videoOverlay = document.getElementById('videoOverlay');
const sourceTag = document.getElementById('sourceTag');

let activeSource = 'camera'; // 'camera' atau 'file'
let localStream = null;
let currentRoomId = null;
let connectedViewers = 0;
let broadcasting = false;
let isMicMuted = false;

// ==========================================================================
// TOAST
// ==========================================================================
function showToast(msg) {
  const toast = document.getElementById('toastAlert');
  const toastMsg = document.getElementById('toastMsg');
  if (!toast || !toastMsg) return;
  toastMsg.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ==========================================================================
// TAB SWITCHING (KAMERA vs FILE VIDEO)
// ==========================================================================
if (tabCameraBtn && tabFileBtn) {
  tabCameraBtn.addEventListener('click', () => {
    activeSource = 'camera';
    tabCameraBtn.className = 'btn-primary';
    tabCameraBtn.style.background = '#2563eb';
    tabFileBtn.className = 'btn-icon';
    tabFileBtn.style.background = '#1e293b';

    cameraSourcePanel.style.display = 'block';
    fileSourcePanel.style.display = 'none';
  });

  tabFileBtn.addEventListener('click', () => {
    activeSource = 'file';
    tabFileBtn.className = 'btn-primary';
    tabFileBtn.style.background = '#2563eb';
    tabCameraBtn.className = 'btn-icon';
    tabCameraBtn.style.background = '#1e293b';

    fileSourcePanel.style.display = 'block';
    cameraSourcePanel.style.display = 'none';
  });
}

// ==========================================================================
// FITUR 1: SIARAN KAMERA WEBCAM (BARU)
// ==========================================================================
async function getCameraDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    if (cameraDeviceSelect) {
      cameraDeviceSelect.innerHTML = '';
      if (videoDevices.length === 0) {
        cameraDeviceSelect.innerHTML = '<option value="">Kamera tidak terdeteksi</option>';
        return;
      }
      videoDevices.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.text = dev.label || `Kamera ${idx + 1}`;
        cameraDeviceSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error membaca perangkat kamera:', err);
  }
}

async function startCameraBroadcast() {
  try {
    const selectedDeviceId = cameraDeviceSelect ? cameraDeviceSelect.value : undefined;
    const constraints = {
      video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      audio: true
    };

    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.src = '';
    localVideo.srcObject = localStream;
    localVideo.style.display = 'block';
    localVideo.play();

    if (videoPlaceholder) videoPlaceholder.style.display = 'none';
    if (videoOverlay) videoOverlay.style.display = 'flex';
    if (sourceTag) sourceTag.textContent = '📷 Kamera Langsung';

    broadcasting = true;

    if (statusBadge) statusBadge.className = 'status-pill live';
    if (statusText) statusText.innerText = 'Menyiarkan Kamera';

    if (startCamBtn) {
      startCamBtn.innerHTML = '<span>🔄</span> Ganti / Refresh Kamera';
    }
    if (toggleMicBtn) {
      toggleMicBtn.disabled = false;
    }

    // Perbarui track pada peer connection yang sudah terhubung
    broadcastStreamTracks();

    showToast('Kamera aktif! Orang yang memasukkan token akan melihat video kamera Anda.');
    getCameraDevices(); // Refresh nama kamera setelah izin diberikan
  } catch (err) {
    showToast('Gagal membuka kamera: ' + err.message);
    console.error(err);
  }
}

if (startCamBtn) {
  startCamBtn.addEventListener('click', startCameraBroadcast);
}

if (toggleMicBtn) {
  toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isMicMuted = !isMicMuted;
      audioTrack.enabled = !isMicMuted;
      micIconText.textContent = isMicMuted ? '🔇' : '🎙️';
      toggleMicBtn.style.color = isMicMuted ? '#ef4444' : '#fff';
      showToast(isMicMuted ? 'Mikrofon di-mute' : 'Mikrofon aktif');
    }
  });
}

// ==========================================================================
// FITUR 2: SIARAN FILE VIDEO
// ==========================================================================
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function loadVideoFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    showToast('File bukan format video yang didukung!');
    return;
  }

  if (fileNameEl) fileNameEl.innerText = file.name;
  if (fileSizeEl) fileSizeEl.innerText = formatBytes(file.size) + ' • ' + file.type;
  if (fileInfo) fileInfo.style.display = 'flex';

  localVideo.srcObject = null;
  const url = URL.createObjectURL(file);
  localVideo.src = url;
  localVideo.style.display = 'block';

  if (videoPlaceholder) videoPlaceholder.style.display = 'none';
  if (videoOverlay) videoOverlay.style.display = 'flex';
  if (sourceTag) sourceTag.textContent = '🎥 File Video';

  if (startBroadcastBtn) {
    startBroadcastBtn.disabled = false;
    startBroadcastBtn.style.opacity = '1';
  }

  if (statusBadge) statusBadge.className = 'status-pill ready';
  if (statusText) statusText.innerText = 'File Siap Disiarkan';
  showToast(`File "${file.name}" berhasil dimuat!`);
}

if (pickFileBtn) {
  pickFileBtn.addEventListener('click', () => videoFileInput.click());
}

if (videoFileInput) {
  videoFileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadVideoFile(e.target.files[0]);
  });
}

if (dropZone) {
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(99,102,241,0.9)';
    dropZone.style.background = 'rgba(99,102,241,0.12)';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'rgba(99,102,241,0.4)';
    dropZone.style.background = 'rgba(99,102,241,0.05)';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(99,102,241,0.4)';
    dropZone.style.background = 'rgba(99,102,241,0.05)';
    const file = e.dataTransfer.files[0];
    if (file) loadVideoFile(file);
  });
}

function startFileBroadcast() {
  try {
    if (!localVideo.src) throw new Error('Belum ada file video dipilih!');
    localStream = localVideo.captureStream ? localVideo.captureStream(30) : localVideo.mozCaptureStream(30);
    broadcasting = true;

    localVideo.play();

    if (statusBadge) statusBadge.className = 'status-pill live';
    if (statusText) statusText.innerText = 'Sedang Menyiarkan File';
    if (startBroadcastBtn) {
      startBroadcastBtn.disabled = true;
      startBroadcastBtn.style.opacity = '0.6';
      startBroadcastBtn.innerHTML = '<span>📡</span> Sedang Menyiarkan...';
    }
    if (stopBroadcastBtn) {
      stopBroadcastBtn.disabled = false;
      stopBroadcastBtn.style.opacity = '1';
    }

    broadcastStreamTracks();
    showToast('Siaran file video dimulai!');
  } catch (err) {
    showToast('Gagal memulai siaran file: ' + err.message);
  }
}

function stopFileBroadcast() {
  broadcasting = false;
  localVideo.pause();

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  if (statusBadge) statusBadge.className = 'status-pill ready';
  if (statusText) statusText.innerText = 'Siaran Dihentikan';
  if (startBroadcastBtn) {
    startBroadcastBtn.disabled = false;
    startBroadcastBtn.style.opacity = '1';
    startBroadcastBtn.innerHTML = '<span>📡</span> Siarkan Ulang';
  }
  if (stopBroadcastBtn) {
    stopBroadcastBtn.disabled = true;
    stopBroadcastBtn.style.opacity = '0.5';
  }
  showToast('Siaran dihentikan.');
}

if (startBroadcastBtn) startBroadcastBtn.addEventListener('click', startFileBroadcast);
if (stopBroadcastBtn) stopBroadcastBtn.addEventListener('click', stopFileBroadcast);

// Update stream ke semua viewer yang tersambung
function broadcastStreamTracks() {
  if (!localStream) return;
  Object.values(peerConnections).forEach(pc => {
    localStream.getTracks().forEach(track => {
      const senders = pc.getSenders();
      const existing = senders.find(s => s.track && s.track.kind === track.kind);
      if (existing) existing.replaceTrack(track);
      else pc.addTrack(track, localStream);
    });
  });
}

// ==========================================================================
// SOCKET.IO & WEBRTC SIGNALING
// ==========================================================================
function initSignaling() {
  currentRoomId = Math.random().toString(36).substring(2, 10);
  if (tokenDisplay) tokenDisplay.innerText = currentRoomId;
  socket.emit('join-room', currentRoomId);

  socket.on('viewer-joined', async ({ viewerId }) => {
    connectedViewers++;
    if (viewerCountEl) viewerCountEl.innerText = `${connectedViewers} Penonton Terhubung`;
    showToast(`Viewer baru terhubung (${viewerId.substring(0, 5)}...)`);

    const pc = new RTCPeerConnection(config);
    peerConnections[viewerId] = pc;

    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { roomId: currentRoomId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        connectedViewers = Math.max(0, connectedViewers - 1);
        if (viewerCountEl) viewerCountEl.innerText = `${connectedViewers} Penonton Terhubung`;
        delete peerConnections[viewerId];
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: viewerId, sdp: offer });
  });

  socket.on('answer', async ({ sdp, viewerId }) => {
    const pc = peerConnections[viewerId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on('ice-candidate', async ({ candidate, senderId }) => {
    const pc = peerConnections[senderId];
    if (pc && candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  });
}

// Salin Token
if (copyTokenBtn) {
  copyTokenBtn.addEventListener('click', () => {
    if (!currentRoomId) return;
    navigator.clipboard.writeText(currentRoomId).then(() => {
      showToast('Token disalin ke clipboard!');
    });
  });
}

// Inisialisasi awal
initSignaling();
getCameraDevices();
