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
const activeRooms = new Map(); // Track active call rooms

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
    console.log("Call request:", data);
    const therapistSocketId = connectedTherapists.get(data.therapistId);

    if (therapistSocketId) {
      // Store room info for WebRTC signaling
      activeRooms.set(data.roomId, {
        userId: data.userId,
        therapistId: data.therapistId,
        userSocketId: socket.id,
        therapistSocketId: therapistSocketId,
      });

      console.log(`Notifying therapist ${data.therapistId} of incoming call`);
      io.to(therapistSocketId).emit("incoming-call", {
        userId: data.userId,
        userName: data.userName || "User",
        roomId: data.roomId,
      });
    } else {
      console.log(`Therapist ${data.therapistId} not connected`);
      socket.emit("call-rejected", { reason: "Therapist not available" });
    }
  });

  socket.on("call-accepted", (data) => {
    console.log("Call accepted:", data);
    const userSocketId = connectedUsers.get(data.userId);

    if (userSocketId) {
      io.to(userSocketId).emit("call-accepted", {
        therapistId: data.therapistId,
        roomId: data.roomId,
      });
      console.log(`Notified user ${data.userId} that call was accepted`);
    }
  });

  socket.on("call-rejected", (data) => {
    console.log("Call rejected:", data);
    const userSocketId = connectedUsers.get(data.userId);

    if (userSocketId) {
      io.to(userSocketId).emit("call-rejected", {
        therapistId: data.therapistId,
      });
    }

    // Remove room from active rooms
    const roomToRemove = Array.from(activeRooms.entries()).find(
      ([_, room]) => room.userId === data.userId
    );
    if (roomToRemove) {
      activeRooms.delete(roomToRemove[0]);
      console.log(`Removed room ${roomToRemove[0]} after rejection`);
    }
  });

  // WebRTC signaling handlers
  socket.on("offer", (data) => {
    console.log(`Received offer for room ${data.roomId}`);
    const room = activeRooms.get(data.roomId);

    if (room) {
      console.log(
        `Forwarding offer to therapist socket ${room.therapistSocketId}`
      );
      io.to(room.therapistSocketId).emit("offer", {
        roomId: data.roomId,
        offer: data.offer,
      });
    } else {
      console.log(`Room ${data.roomId} not found for offer`);
    }
  });

  socket.on("answer", (data) => {
    console.log(`Received answer for room ${data.roomId}`);
    const room = activeRooms.get(data.roomId);

    if (room) {
      console.log(`Forwarding answer to user socket ${room.userSocketId}`);
      io.to(room.userSocketId).emit("answer", {
        roomId: data.roomId,
        answer: data.answer,
      });
    } else {
      console.log(`Room ${data.roomId} not found for answer`);
    }
  });

  socket.on("ice-candidate", (data) => {
    console.log(`Received ICE candidate for room ${data.roomId}`);
    const room = activeRooms.get(data.roomId);

    if (room) {
      // Determine which socket to send to (the other participant)
      const targetSocketId =
        socket.id === room.userSocketId
          ? room.therapistSocketId
          : room.userSocketId;

      console.log(`Forwarding ICE candidate to socket ${targetSocketId}`);
      io.to(targetSocketId).emit("ice-candidate", {
        roomId: data.roomId,
        candidate: data.candidate,
      });
    } else {
      console.log(`Room ${data.roomId} not found for ICE candidate`);
    }
  });

  socket.on("end-call", (data) => {
    console.log(`Call ended for room ${data.roomId}`);
    const room = activeRooms.get(data.roomId);

    if (room) {
      // Notify the other participant
      const targetSocketId =
        socket.id === room.userSocketId
          ? room.therapistSocketId
          : room.userSocketId;

      console.log(
        `Notifying other party (socket ${targetSocketId}) that call ended`
      );
      io.to(targetSocketId).emit("call-ended");

      // Remove room from active rooms
      activeRooms.delete(data.roomId);
      console.log(`Removed room ${data.roomId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    if (socket.userType === "user" && socket.userId) {
      connectedUsers.delete(socket.userId);
      console.log(`Removed user ${socket.userId} from connected users`);
    } else if (socket.userType === "therapist" && socket.therapistId) {
      connectedTherapists.delete(socket.therapistId);
      console.log(
        `Removed therapist ${socket.therapistId} from connected therapists`
      );
    }

    // Clean up any active rooms this socket was part of
    for (const [roomId, room] of activeRooms.entries()) {
      if (
        room.userSocketId === socket.id ||
        room.therapistSocketId === socket.id
      ) {
        console.log(`Cleaning up room ${roomId} due to disconnect`);

        // Notify the other participant that the call ended
        const otherSocketId =
          room.userSocketId === socket.id
            ? room.therapistSocketId
            : room.userSocketId;

        if (otherSocketId) {
          console.log(
            `Notifying other party (socket ${otherSocketId}) of disconnect`
          );
          io.to(otherSocketId).emit("call-ended");
        }

        activeRooms.delete(roomId);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
