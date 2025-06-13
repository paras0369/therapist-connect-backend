// server.js - WebRTC Video Calling Server
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");

dotenv.config();

const app = express();
const server = http.createServer(app);

// Import WebRTC SignalingServer
const SignalingServer = require("./services/signalingServer");

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

// Initialize WebRTC Signaling Server
const signalingServer = new SignalingServer(server);

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

// WebRTC signaling status endpoint
app.get("/api/webrtc/status", (req, res) => {
  res.json({
    connectedUsers: signalingServer.getConnectedUsersCount(),
    activeCalls: signalingServer.getActiveCallsCount(),
    status: "running"
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebRTC Signaling Server running on ws://localhost:${PORT}`);
});

module.exports = { app, server, signalingServer };