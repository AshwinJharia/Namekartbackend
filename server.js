const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const TaskScheduler = require('./utils/taskScheduler');
const userRoutes = require('./routes/users');
const taskRoutes = require('./routes/tasks');
const Notification = require('./models/Notification');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.FRONTEND_URL
        : "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket"],
  upgrade: false,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Make io globally accessible
global.io = io;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize task scheduler
const taskScheduler = new TaskScheduler();
app.set("taskScheduler", taskScheduler);
app.set("io", io);

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Handle client authentication
  socket.on("authenticate", (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.join(decoded.userId.toString()); // Join a room specific to this user
      console.log("User authenticated:", decoded.userId);
    } catch (error) {
      console.error("Authentication failed:", error);
    }
  });

  // Handle notification acknowledgment
  socket.on("notificationRead", async (notificationId) => {
    try {
      // Update notification status in database
      await Notification.findByIdAndUpdate(notificationId, { read: true });
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  socket.on("disconnect", (reason) => {
    console.log("Client disconnected:", socket.id, "Reason:", reason);
  });
});

// Routes
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    // Start the server after DB connection
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
    // Initialize task scheduler after DB connection
    taskScheduler.init();
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
  });

// Error handling for the server
server.on("error", (error) => {
  console.error("Server error:", error);
});
