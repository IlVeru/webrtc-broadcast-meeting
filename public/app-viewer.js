// app-viewer.js - Logika Viewer Sederhana untuk Percobaan 1
const socket = io();
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const remoteVideo = document.getElementById('remoteVideo');
const tokenInput = document.getElementById('tokenInput');
const joinBtn = document.getElementById('joinBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const liveTag = document.getElementById('liveTag');
const unmuteBtn = document.getElementById('unmuteBtn');
const fsBtn = document.getElementById('fsBtn');
const videoStage = document.getElementById('videoStage');

let peerConnection = null;
let currentRoomId = null;
const candidateQueue = [];

function showToast(msg) {
  const toast = document.getElementById('toastAlert');
  const toastMsg = document.getElementById('toastMsg');
  if (toast && toastMsg) {
    toastMsg.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

function startView(roomId) {
  currentRoomId = roomId;
  if (statusText) statusText.innerText = 'Menghubungkan ke Room...';
  if (joinBtn) {
    joinBtn.disabled = true;
    joinBtn.innerHTML = '<span>⏳</span> Menghubungkan...';
  }

  socket.emit('join-as-viewer', roomId);
  console.log('Bergabung sebagai viewer ke room:', roomId);

  // Menerima SDP Offer dari Broadcaster
  socket.on('offer', async ({ sdp, broadcasterId }) => {
    console.log('Menerima offer dari broadcaster:', broadcasterId);
    peerConnection = new RTCPeerConnection(config);

    // Menerima stream video/audio dari broadcaster
    peerConnection.ontrack = event => {
      console.log('Track media diterima:', event.streams);
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.play().catch(e => console.warn('Play error:', e));
      }
      if (statusBadge) statusBadge.className = 'status-pill live';
      if (statusText) statusText.innerText = 'Siaran Terhubung (Live)';
      if (liveTag) liveTag.style.display = 'inline-flex';
      if (joinBtn) {
        joinBtn.innerHTML = '<span>✅</span> Terhubung';
        joinBtn.disabled = true;
      }
      showToast('Berhasil terhubung ke siaran video!');
    };

    // Mengirim ICE Candidate ke broadcaster
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        socket.emit('ice-candidate', { roomId, candidate: event.candidate });
      }
    };

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

      // Proses antrean candidate yang sudah tiba
      while (candidateQueue.length > 0) {
        const c = candidateQueue.shift();
        await peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.error(e));
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', { target: broadcasterId, sdp: answer });
      console.log('SDP Answer dikirim ke broadcaster');
    } catch (err) {
      console.error('Proses offer/answer gagal:', err);
    }
  });

  // Menerima ICE Candidate
  socket.on('ice-candidate', async ({ candidate, senderId }) => {
    if (senderId !== socket.id) {
      if (peerConnection && peerConnection.remoteDescription) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('addIceCandidate error:', err);
        }
      } else {
        candidateQueue.push(candidate);
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Tombol Join
  if (joinBtn) {
    joinBtn.addEventListener('click', () => {
      const token = tokenInput.value.trim();
      if (token) {
        startView(token);
      } else {
        showToast('Silakan masukkan token kamar terlebih dahulu!');
        tokenInput.focus();
      }
    });
  }

  // Tekan Enter untuk submit
  if (tokenInput) {
    tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        joinBtn.click();
      }
    });

    // Cek jika ada parameter token di URL (?token=xyz)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get('token');
    if (tokenParam) {
      tokenInput.value = tokenParam;
      setTimeout(() => joinBtn.click(), 500);
    }
  }

  // Tombol Unmute Audio
  if (unmuteBtn) {
    unmuteBtn.addEventListener('click', () => {
      remoteVideo.muted = !remoteVideo.muted;
      const unmuteText = document.getElementById('unmuteText');
      const unmuteIcon = document.getElementById('unmuteIcon');
      if (remoteVideo.muted) {
        if (unmuteText) unmuteText.innerText = 'Unmute Audio';
        if (unmuteIcon) unmuteIcon.innerText = '🔇';
        showToast('Audio dibisukan');
      } else {
        if (unmuteText) unmuteText.innerText = 'Mute Audio';
        if (unmuteIcon) unmuteIcon.innerText = '🔊';
        showToast('Audio diaktifkan');
      }
    });
  }

  // Tombol Layar Penuh
  if (fsBtn && videoStage) {
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        videoStage.requestFullscreen().catch(e => console.warn(e));
      } else {
        document.exitFullscreen();
      }
    });
  }
});
