const socket = io();

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

const peerConnections = {};
const pendingCandidatesByViewer = {};

// ======================================================
// LOG KONEKSI SOCKET.IO
// ======================================================

socket.on("connect", () => {
  console.log("[Socket.IO] Terhubung:", socket.id);
});

socket.on("connect_error", (error) => {
  console.error("[Socket.IO] Gagal:", error.message);
});

socket.on("disconnect", (reason) => {
  console.warn("[Socket.IO] Terputus:", reason);
});

// ======================================================
// FALLBACK POLA UJI JIKA WEBCAM GAGAL
// ======================================================

function createTestPatternStream(label = "BROADCASTER STUDIO") {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;

  const ctx = canvas.getContext("2d");
  let frame = 0;

  function draw() {
    frame++;

    const gradient = ctx.createLinearGradient(
      0, 0, canvas.width, canvas.height
    );

    gradient.addColorStop(0, "#090d16");
    gradient.addColorStop(1, "#1e1b4b");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const colors = [
      "#ffffff", "#facc15", "#06b6d4",
      "#22c55e", "#ec4899", "#ef4444", "#3b82f6"
    ];

    const barWidth = canvas.width / colors.length;

    colors.forEach((color, index) => {
      ctx.fillStyle = color;
      ctx.fillRect(index * barWidth, 380, barWidth, 100);
    });

    const x = canvas.width / 2 + Math.cos(frame * 0.05) * 190;
    const y = 200 + Math.sin(frame * 0.08) * 55;

    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fillStyle = "#6366f1";
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, canvas.width / 2, 80);

    ctx.font = "bold 36px monospace";
    ctx.fillStyle = "#38bdf8";

    const time = new Date().toLocaleTimeString();
    ctx.fillText(time, canvas.width / 2, 140);

    requestAnimationFrame(draw);
  }

  draw();

  return canvas.captureStream(30);
}

// ======================================================
// LOGIKA BROADCASTER
// ======================================================

export async function startBroadcast() {
  const localVideo = document.getElementById("localVideo");
  const tokenDisplay = document.getElementById("token");

  // Jangan tampilkan token sebelum broadcaster siap.
  if (tokenDisplay) {
    tokenDisplay.innerText = "Menyiapkan siaran...";
  }

  let localStream;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
  } catch (error) {
    console.warn("Kamera/mikrofon gagal dibuka:", error);

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
    } catch (secondError) {
      console.warn("Menggunakan pola uji:", secondError);
      localStream = createTestPatternStream(
        "BROADCASTER (KAMERA SIMULASI)"
      );
    }
  }

  if (localVideo) {
    localVideo.srcObject = localStream;
    localVideo.muted = true;
    localVideo.playsInline = true;

    try {
      await localVideo.play();
    } catch (error) {
      console.warn("Pemutaran video lokal:", error);
    }
  }

  // Siapkan listener SEBELUM room dibuka untuk viewer.
  socket.off("viewer-joined");
  socket.off("answer");
  socket.off("ice-candidate");

  // Broadcaster menerima pemberitahuan viewer baru.
  socket.on("viewer-joined", async ({ viewerId }) => {
    console.log("[Broadcaster] Viewer bergabung:", viewerId);

    try {
      // Bersihkan koneksi lama jika viewer tersambung ulang.
      if (peerConnections[viewerId]) {
        peerConnections[viewerId].close();
      }

      const pc = new RTCPeerConnection(config);

      peerConnections[viewerId] = pc;
      pendingCandidatesByViewer[viewerId] = [];

      pc.onconnectionstatechange = () => {
        console.log(
          `[Broadcaster] Koneksi ${viewerId}:`,
          pc.connectionState
        );
      };

      pc.oniceconnectionstatechange = () => {
        console.log(
          `[Broadcaster] ICE ${viewerId}:`,
          pc.iceConnectionState
        );
      };

      // Kirim track video/audio kepada viewer.
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            roomId,
            candidate: event.candidate
          });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("offer", {
        target: viewerId,
        sdp: pc.localDescription
      });

      console.log("[Broadcaster] Offer dikirim:", viewerId);
    } catch (error) {
      console.error("[Broadcaster] Gagal membuat offer:", error);
    }
  });

  // Menerima SDP Answer dari viewer.
  socket.on("answer", async ({ sdp, viewerId }) => {
    console.log("[Broadcaster] Answer diterima:", viewerId);

    const pc = peerConnections[viewerId];

    if (!pc) {
      console.error("Koneksi viewer tidak ditemukan:", viewerId);
      return;
    }

    try {
      await pc.setRemoteDescription(sdp);

      // Proses ICE Candidate yang datang terlalu awal.
      const queued = pendingCandidatesByViewer[viewerId] || [];

      for (const candidate of queued) {
        await pc.addIceCandidate(candidate);
      }

      pendingCandidatesByViewer[viewerId] = [];

      console.log("[Broadcaster] Remote description siap.");
    } catch (error) {
      console.error("[Broadcaster] Gagal memproses answer:", error);
    }
  });

  // Menerima ICE Candidate dari viewer.
  socket.on("ice-candidate", async ({ candidate, senderId }) => {
    if (senderId === socket.id) return;

    const pc = peerConnections[senderId];

    if (!pc || !candidate) return;

    try {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(candidate);
      } else {
        pendingCandidatesByViewer[senderId] ??= [];
        pendingCandidatesByViewer[senderId].push(candidate);
      }
    } catch (error) {
      console.error("[Broadcaster] Gagal menambahkan ICE:", error);
    }
  });

  // Buat room setelah semua listener broadcaster siap.
  const roomId = Math.random().toString(36).substring(2, 10);

  socket.emit("join-room", roomId);

  if (tokenDisplay) {
    tokenDisplay.innerText = roomId;
    tokenDisplay.title = "Klik untuk menyalin";

    tokenDisplay.onclick = async () => {
      try {
        await navigator.clipboard.writeText(roomId);
        console.log("Token berhasil disalin.");
      } catch (error) {
        console.error("Gagal menyalin token:", error);
      }
    };
  }

  console.log("[Broadcaster] Siap. Token:", roomId);
}

// ======================================================
// LOGIKA VIEWER
// ======================================================

export async function startView(roomId) {
  const remoteVideo = document.getElementById("remoteVideo");

  let peerConnection = null;
  let broadcasterId = null;
  const candidateQueue = [];

  if (!roomId || !roomId.trim()) {
    console.error("Token room kosong.");
    return;
  }

  if (!remoteVideo) {
    console.error("Elemen remoteVideo tidak ditemukan.");
    return;
  }

  remoteVideo.autoplay = true;
  remoteVideo.playsInline = true;
  remoteVideo.muted = true;
  remoteVideo.controls = true;

  // Bersihkan listener sebelumnya agar tidak berulang.
  socket.off("offer");
  socket.off("ice-candidate");

  // Proses offer dari broadcaster.
  socket.on("offer", async ({ sdp, broadcasterId: senderId }) => {
    console.log("[Viewer] Offer diterima:", senderId);

    try {
      if (peerConnection) {
        peerConnection.close();
      }

      broadcasterId = senderId;
      peerConnection = new RTCPeerConnection(config);

      peerConnection.onconnectionstatechange = () => {
        console.log(
          "[Viewer] Status koneksi:",
          peerConnection.connectionState
        );
      };

      peerConnection.oniceconnectionstatechange = () => {
        console.log(
          "[Viewer] Status ICE:",
          peerConnection.iceConnectionState
        );
      };

      // Stream video diterima di sini.
      peerConnection.ontrack = async (event) => {
        console.log("[Viewer] Track diterima:", event.track.kind);

        const stream = event.streams?.[0] ||
          new MediaStream([event.track]);

        remoteVideo.srcObject = stream;

        try {
          await remoteVideo.play();
          console.log("[Viewer] Video berhasil diputar.");
        } catch (error) {
          console.warn(
            "[Viewer] Pemutaran otomatis gagal:",
            error
          );
        }
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            roomId,
            candidate: event.candidate
          });
        }
      };

      await peerConnection.setRemoteDescription(sdp);

      // Gunakan hanya kandidat milik broadcaster ini.
      while (candidateQueue.length > 0) {
        const item = candidateQueue.shift();

        if (item.senderId === broadcasterId) {
          await peerConnection.addIceCandidate(item.candidate);
        }
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit("answer", {
        target: broadcasterId,
        sdp: peerConnection.localDescription
      });

      console.log("[Viewer] Answer dikirim:", broadcasterId);
    } catch (error) {
      console.error("[Viewer] Gagal memproses offer:", error);
    }
  });

  // Proses kandidat jaringan dari broadcaster.
  socket.on("ice-candidate", async ({ candidate, senderId }) => {
    if (senderId === socket.id || !candidate) return;

    // Simpan dulu jika offer belum diterima.
    if (!broadcasterId || !peerConnection?.remoteDescription) {
      candidateQueue.push({ candidate, senderId });
      return;
    }

    // Abaikan kandidat milik viewer lain.
    if (senderId !== broadcasterId) return;

    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (error) {
      console.error("[Viewer] Gagal menambahkan ICE:", error);
    }
  });

  // Listener sudah aktif, baru viewer bergabung ke room.
  socket.emit("join-as-viewer", roomId);

  console.log("[Viewer] Meminta bergabung ke room:", roomId);
}