// server.js
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

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("user-connect", (userId) => {
    connectedUsers.set(userId, socket.id);
    socket.userId = userId;
    socket.userType = "user";
    console.log(`User ${userId} connected with socket ${socket.id}`);
  });

  socket.on("therapist-connect", (therapistId) => {
    connectedTherapists.set(therapistId, socket.id);
    socket.therapistId = therapistId;
    socket.userType = "therapist";
    console.log(`Therapist ${therapistId} connected with socket ${socket.id}`);
  });

  socket.on("call-therapist", (data) => {
    const therapistSocketId = connectedTherapists.get(data.therapistId);
    if (therapistSocketId) {
      console.log(
        `Routing call from user ${data.userId} to therapist ${data.therapistId}`
      );
      io.to(therapistSocketId).emit("incoming-call", {
        userId: data.userId,
        userName: data.userName || "User",
        roomId: data.roomId,
      });
    } else {
      console.log(`Therapist ${data.therapistId} is not connected`);
      // Notify user that therapist is not available
      const userSocketId = connectedUsers.get(data.userId);
      if (userSocketId) {
        io.to(userSocketId).emit("call-rejected", {
          therapistId: data.therapistId,
          reason: "Therapist not online",
        });
      }
    }
  });

  socket.on("call-accepted", (data) => {
    const userSocketId = connectedUsers.get(data.userId);
    if (userSocketId) {
      console.log(
        `Call accepted by therapist ${data.therapistId} for user ${data.userId}`
      );
      io.to(userSocketId).emit("call-accepted", {
        therapistId: data.therapistId,
        roomId: data.roomId,
      });
    }
  });

  socket.on("call-rejected", (data) => {
    const userSocketId = connectedUsers.get(data.userId);
    if (userSocketId) {
      console.log(
        `Call rejected by therapist ${data.therapistId} for user ${data.userId}`
      );
      io.to(userSocketId).emit("call-rejected", {
        therapistId: data.therapistId,
      });
    }
  });

  // WebRTC signaling events
  socket.on("offer", (data) => {
    console.log(
      `Offer received for room ${data.roomId} from socket ${socket.id}`
    );
    const roomSockets = io.sockets.adapter.rooms.get(data.roomId);
    console.log(
      `Room ${data.roomId} has ${roomSockets ? roomSockets.size : 0} members`
    );
    socket.to(data.roomId).emit("offer", data);
  });

  socket.on("answer", (data) => {
    console.log(
      `Answer received for room ${data.roomId} from socket ${socket.id}`
    );
    const roomSockets = io.sockets.adapter.rooms.get(data.roomId);
    console.log(
      `Room ${data.roomId} has ${roomSockets ? roomSockets.size : 0} members`
    );
    socket.to(data.roomId).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    console.log(
      `ICE candidate received for room ${data.roomId} from socket ${socket.id}`
    );
    socket.to(data.roomId).emit("ice-candidate", data);
  });

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
    // Notify others in the room that someone joined
    socket.to(roomId).emit("user-joined", { socketId: socket.id });
  });

  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room ${roomId}`);
  });

  socket.on("end-call", (data) => {
    console.log(`Call ended in room ${data.roomId}`);
    socket.to(data.roomId).emit("call-ended");
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (socket.userType === "user" && socket.userId) {
      connectedUsers.delete(socket.userId);
      console.log(`User ${socket.userId} disconnected`);
    } else if (socket.userType === "therapist" && socket.therapistId) {
      connectedTherapists.delete(socket.therapistId);
      console.log(`Therapist ${socket.therapistId} disconnected`);
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(
    `MongoDB URI: ${
      process.env.MONGODB_URI || "mongodb://localhost:27017/therapist-connect"
    }`
  );
});
