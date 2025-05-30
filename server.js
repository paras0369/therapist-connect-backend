// Enhanced backend/server.js - Fixed call flow with consolidated socket handlers
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const socketIO = require("socket.io");
const FirebaseNotificationService = require("./services/firebaseAdmin");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose
  .connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/therapist-connect"
  )
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const therapistRoutes = require("./routes/therapist");
const callRoutes = require("./routes/call");

// Use routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/therapist", therapistRoutes);
app.use("/api/call", callRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Socket.io for real-time communication
const connectedUsers = new Map();
const connectedTherapists = new Map();
const activeCalls = new Map(); // Track active calls

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // User connection - support both old and new formats
  socket.on("user-connect", (data) => {
    const userId = typeof data === "string" ? data : data.userId;
    const userInfo = typeof data === "object" ? data.userInfo : null;

    connectedUsers.set(userId, {
      socketId: socket.id,
      userInfo,
      connectedAt: new Date(),
    });
    socket.userId = userId;
    socket.userType = "user";
    console.log(`User ${userId} connected with socket ${socket.id}`);

    // Send connection confirmation
    socket.emit("connection-confirmed", {
      status: "connected",
      userId,
      serverTime: new Date(),
    });
  });

  // Therapist connection - support both old and new formats
  socket.on("therapist-connect", (data) => {
    const therapistId = typeof data === "string" ? data : data.therapistId;
    const therapistInfo = typeof data === "object" ? data.therapistInfo : null;

    connectedTherapists.set(therapistId, {
      socketId: socket.id,
      therapistInfo,
      connectedAt: new Date(),
    });
    socket.therapistId = therapistId;
    socket.userType = "therapist";
    console.log(`Therapist ${therapistId} connected with socket ${socket.id}`);

    // Send connection confirmation
    socket.emit("connection-confirmed", {
      status: "connected",
      therapistId,
      serverTime: new Date(),
    });
  });

  // CONSOLIDATED: Handle both call-therapist and initiate-call events
  socket.on("call-therapist", async (data) => {
    await handleCallInitiation(data);
  });

  socket.on("initiate-call", async (data) => {
    await handleCallInitiation(data);
  });

  // Consolidated call initiation handler
  async function handleCallInitiation(data) {
    try {
      const { callId, therapistId, userId, userName, roomId } = data;
      console.log(
        `Call initiated: User ${userId} -> Therapist ${therapistId}`,
        data
      );

      // Store active call info
      if (callId) {
        activeCalls.set(callId, {
          userId,
          therapistId,
          roomId,
          status: "ringing",
          initiatedAt: new Date(),
        });
      }

      // Get therapist connection
      const therapistConnection = connectedTherapists.get(therapistId);
      const userConnection = connectedUsers.get(userId);

      // Send Firebase notification to therapist
      const Therapist = require("./models/Therapist");
      const therapist = await Therapist.findById(therapistId);

      if (therapist && therapist.fcmToken) {
        console.log(
          `Sending Firebase notification to therapist ${therapistId}`
        );

        if (FirebaseNotificationService.isTherapistAppReady()) {
          await FirebaseNotificationService.sendCallNotification(
            therapist.fcmToken,
            {
              userId,
              userName: userName || "User",
              roomId,
              callId,
              type: "incoming_call",
            }
          );
          console.log("Firebase notification sent successfully");
        } else {
          console.error("Therapist Firebase app not initialized");
        }
      }

      // Send socket notification if therapist is connected
      if (therapistConnection) {
        console.log(`Sending socket notification to therapist ${therapistId}`);
        io.to(therapistConnection.socketId).emit("incoming-call", {
          callId,
          userId,
          userName: userName || "User",
          roomId,
          userAvatar: data.userAvatar || null,
        });
      } else {
        console.log(`Therapist ${therapistId} not connected via socket`);
      }

      // Set call timeout (30 seconds)
      if (callId) {
        setTimeout(() => {
          const call = activeCalls.get(callId);
          if (call && call.status === "ringing") {
            console.log(`Call ${callId} timed out`);
            activeCalls.delete(callId);

            // Notify user of timeout
            if (userConnection) {
              io.to(userConnection.socketId).emit("call-timeout", { callId });
            }
          }
        }, 30000);
      }
    } catch (error) {
      console.error("Error handling call initiation:", error);
      socket.emit("call-error", { error: "Failed to initiate call" });
    }
  }

  // Call accepted by therapist
  socket.on("call-accepted", (data) => {
    const { callId, therapistId, userId, roomId } = data;
    console.log(
      `Call accepted by therapist ${therapistId} for user ${userId}`,
      data
    );

    // Update call status
    if (callId && activeCalls.has(callId)) {
      const call = activeCalls.get(callId);
      call.status = "answered";
      call.answeredAt = new Date();
    }

    // Notify user that call was accepted
    const userConnection = connectedUsers.get(userId);
    if (userConnection) {
      console.log(`Notifying user ${userId} that call was accepted`);
      io.to(userConnection.socketId).emit("call-accepted", {
        callId,
        therapistId,
        roomId,
        acceptedAt: new Date(),
      });
    } else {
      console.error(
        `User ${userId} not found for call acceptance notification`
      );
    }
  });

  // Alternative call acceptance handler (for backward compatibility)
  socket.on("answer-call", (data) => {
    socket.emit("call-accepted", data);
  });

  // Call rejected by therapist
  socket.on("call-rejected", (data) => {
    const { callId, therapistId, userId, reason } = data;
    console.log(`Call rejected by therapist ${therapistId} for user ${userId}`);

    // Clean up call
    if (callId) {
      activeCalls.delete(callId);
    }

    // Notify user that call was rejected
    const userConnection = connectedUsers.get(userId);
    if (userConnection) {
      io.to(userConnection.socketId).emit("call-rejected", {
        callId,
        therapistId,
        reason: reason || "Call declined",
      });
    }
  });

  // Alternative rejection handler
  socket.on("reject-call", (data) => {
    socket.emit("call-rejected", data);
  });

  // Call cancelled by user
  socket.on("cancel-call", (data) => {
    const { callId, userId, therapistId } = data;
    console.log(`Call ${callId} cancelled by user ${userId}`);

    if (callId) {
      activeCalls.delete(callId);
    }

    // Notify therapist that call was cancelled
    const therapistConnection = connectedTherapists.get(therapistId);
    if (therapistConnection) {
      io.to(therapistConnection.socketId).emit("call-cancelled", {
        callId,
        userId,
      });
    }
  });

  // WebRTC signaling events
  socket.on("offer", (data) => {
    console.log(`WebRTC offer for room ${data.roomId}`);
    socket.to(data.roomId).emit("offer", data);
  });

  socket.on("answer", (data) => {
    console.log(`WebRTC answer for room ${data.roomId}`);
    socket.to(data.roomId).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    console.log(`ICE candidate for room ${data.roomId}`);
    socket.to(data.roomId).emit("ice-candidate", data);
  });

  // Room management
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(
      `Socket ${socket.id} (${
        socket.userType || "unknown"
      }) joined room ${roomId}`
    );
    socket.to(roomId).emit("user-joined", {
      socketId: socket.id,
      userType: socket.userType,
      userId: socket.userId || socket.therapistId,
    });
  });

  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room ${roomId}`);
    socket.to(roomId).emit("user-left", {
      socketId: socket.id,
      userType: socket.userType,
    });
  });

  // Call ended
  socket.on("end-call", (data) => {
    const { callId, roomId, endedBy } = data;
    console.log(`Call ${callId} ended by ${endedBy || socket.userType}`);

    if (callId) {
      activeCalls.delete(callId);
    }

    // Notify all participants in the room
    socket.to(roomId).emit("call-ended", {
      callId,
      endedBy: endedBy || socket.userType,
      endedAt: new Date(),
    });
  });

  // Connection monitoring
  socket.on("heartbeat", () => {
    socket.emit("heartbeat-ack", {
      serverTime: new Date(),
      socketId: socket.id,
      userType: socket.userType,
    });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);

    if (socket.userType === "user" && socket.userId) {
      connectedUsers.delete(socket.userId);
      console.log(`User ${socket.userId} disconnected`);
    } else if (socket.userType === "therapist" && socket.therapistId) {
      connectedTherapists.delete(socket.therapistId);
      console.log(`Therapist ${socket.therapistId} disconnected`);
    }

    // Handle any active calls this user was part of
    for (const [callId, call] of activeCalls.entries()) {
      if (
        call.userId === socket.userId ||
        call.therapistId === socket.therapistId
      ) {
        console.log(`Cleaning up call ${callId} due to disconnect`);
        activeCalls.delete(callId);

        // Notify other participants
        const roomId = call.roomId;
        if (roomId) {
          socket.to(roomId).emit("participant-disconnected", {
            callId,
            disconnectedUser: socket.userType,
            userId: socket.userId || socket.therapistId,
          });
        }
      }
    }
  });

  // Debug endpoint to check connections
  socket.on("debug-connections", () => {
    socket.emit("debug-info", {
      connectedUsers: Array.from(connectedUsers.keys()),
      connectedTherapists: Array.from(connectedTherapists.keys()),
      activeCalls: Array.from(activeCalls.keys()),
      yourSocketId: socket.id,
      yourUserType: socket.userType,
      yourUserId: socket.userId || socket.therapistId,
    });
  });
});

// Periodic cleanup of stale connections and calls
setInterval(() => {
  const now = new Date();
  const timeout = 5 * 60 * 1000; // 5 minutes

  // Clean up stale calls
  for (const [callId, call] of activeCalls.entries()) {
    if (now - call.initiatedAt > timeout) {
      console.log(`Cleaning up stale call: ${callId}`);
      activeCalls.delete(callId);
    }
  }

  // Log current connections (for debugging)
  console.log(
    `Active connections - Users: ${connectedUsers.size}, Therapists: ${connectedTherapists.size}, Calls: ${activeCalls.size}`
  );
}, 60000); // Run every minute

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

module.exports = { app, server, io };
