// server.js - Simplified version without Firebase
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const socketIO = require("socket.io");

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

// Socket.io for real-time communication
const connectedUsers = new Map();
const connectedTherapists = new Map();
const activeCalls = new Map();

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // User connection
  socket.on("user-connect", (data) => {
    const userId = data.userId;
    connectedUsers.set(userId, {
      socketId: socket.id,
      userInfo: data.userInfo,
      connectedAt: new Date(),
    });
    socket.userId = userId;
    socket.userType = "user";
    console.log(`User ${userId} connected with socket ${socket.id}`);

    socket.emit("connection-confirmed", {
      status: "connected",
      userId,
      serverTime: new Date(),
    });
  });

  // Therapist connection
  socket.on("therapist-connect", (data) => {
    const therapistId = data.therapistId;
    connectedTherapists.set(therapistId, {
      socketId: socket.id,
      therapistInfo: data.therapistInfo,
      connectedAt: new Date(),
    });
    socket.therapistId = therapistId;
    socket.userType = "therapist";
    console.log(`Therapist ${therapistId} connected with socket ${socket.id}`);

    socket.emit("connection-confirmed", {
      status: "connected",
      therapistId,
      serverTime: new Date(),
    });
  });

  // Therapist availability change
  socket.on("therapist-availability-change", async (data) => {
    const { therapistId, isAvailable } = data;
    console.log(
      `Therapist ${therapistId} availability changed to: ${isAvailable}`
    );

    try {
      const Therapist = require("./models/Therapist");
      await Therapist.findByIdAndUpdate(therapistId, {
        isAvailable,
        updatedAt: new Date(),
      });

      // Broadcast availability change to all users
      io.emit("therapist-availability-updated", {
        therapistId,
        isAvailable,
      });
    } catch (error) {
      console.error("Error updating therapist availability:", error);
    }
  });

  // Handle call initiation
  socket.on("call-therapist", async (data) => {
    const {
      callId,
      therapistId,
      userId,
      userName,
      roomId,
      zegoCallId,
      callType,
    } = data;
    console.log(
      `Call initiated: User ${userId} -> Therapist ${therapistId}`,
      data
    );

    // Store active call info
    activeCalls.set(callId, {
      userId,
      therapistId,
      roomId,
      zegoCallId,
      callType,
      status: "ringing",
      initiatedAt: new Date(),
    });

    // Get therapist connection
    const therapistConnection = connectedTherapists.get(therapistId);

    if (therapistConnection) {
      // Therapist is online, send call notification via socket
      console.log(
        `Sending call notification to therapist ${therapistId} via socket`
      );
      io.to(therapistConnection.socketId).emit("incoming-call", {
        callId,
        userId,
        userName: userName || "User",
        roomId,
        zegoCallId,
        callType,
      });
    } else {
      // Therapist is offline
      console.log(`Therapist ${therapistId} is offline`);
      socket.emit("call-failed", {
        callId,
        reason: "Therapist is offline",
      });
      activeCalls.delete(callId);
    }

    // Set call timeout (30 seconds)
    setTimeout(() => {
      const call = activeCalls.get(callId);
      if (call && call.status === "ringing") {
        console.log(`Call ${callId} timed out`);
        activeCalls.delete(callId);

        // Notify user of timeout
        socket.emit("call-timeout", { callId });

        // Notify therapist to remove the call
        if (therapistConnection) {
          io.to(therapistConnection.socketId).emit("call-timeout", { callId });
        }
      }
    }, 30000);
  });

  // Call accepted by therapist
  socket.on("call-accepted", (data) => {
    const { callId, therapistId, userId, roomId } = data;
    console.log(`Call ${callId} accepted by therapist ${therapistId}`);

    // Update call status
    if (activeCalls.has(callId)) {
      const call = activeCalls.get(callId);
      call.status = "answered";
      call.answeredAt = new Date();
    }

    // Notify user that call was accepted
    const userConnection = connectedUsers.get(userId);
    if (userConnection) {
      io.to(userConnection.socketId).emit("call-accepted", {
        callId,
        therapistId,
        roomId,
        zegoCallId: activeCalls.get(callId)?.zegoCallId,
      });
    }
  });

  // Call rejected by therapist
  socket.on("call-rejected", (data) => {
    const { callId, therapistId, userId, reason } = data;
    console.log(`Call ${callId} rejected by therapist ${therapistId}`);

    activeCalls.delete(callId);

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

  // Call cancelled by user
  socket.on("cancel-call", (data) => {
    const { callId, userId, therapistId } = data;
    console.log(`Call ${callId} cancelled by user ${userId}`);

    activeCalls.delete(callId);

    // Notify therapist that call was cancelled
    const therapistConnection = connectedTherapists.get(therapistId);
    if (therapistConnection) {
      io.to(therapistConnection.socketId).emit("call-cancelled", {
        callId,
        userId,
      });
    }
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

      // Broadcast therapist offline status
      io.emit("therapist-status-changed", {
        therapistId: socket.therapistId,
        isOnline: false,
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };
