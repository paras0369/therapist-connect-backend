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

// Socket.io for real-time communication
const connectedUsers = new Map();
const connectedTherapists = new Map();

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("user-connect", (userId) => {
    connectedUsers.set(userId, socket.id);
    socket.userId = userId;
    socket.userType = "user";
  });

  socket.on("therapist-connect", (therapistId) => {
    connectedTherapists.set(therapistId, socket.id);
    socket.therapistId = therapistId;
    socket.userType = "therapist";
  });

  socket.on("call-therapist", (data) => {
    const therapistSocketId = connectedTherapists.get(data.therapistId);
    if (therapistSocketId) {
      io.to(therapistSocketId).emit("incoming-call", {
        userId: data.userId,
        userName: data.userName || "User",
        roomId: data.roomId,
      });
    }
  });

  socket.on("call-accepted", (data) => {
    const userSocketId = connectedUsers.get(data.userId);
    if (userSocketId) {
      io.to(userSocketId).emit("call-accepted", {
        therapistId: data.therapistId,
        roomId: data.roomId,
      });
    }
  });

  socket.on("call-rejected", (data) => {
    const userSocketId = connectedUsers.get(data.userId);
    if (userSocketId) {
      io.to(userSocketId).emit("call-rejected", {
        therapistId: data.therapistId,
      });
    }
  });

  socket.on("disconnect", () => {
    if (socket.userType === "user") {
      connectedUsers.delete(socket.userId);
    } else if (socket.userType === "therapist") {
      connectedTherapists.delete(socket.therapistId);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
