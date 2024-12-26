const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');

// Register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Create new user
    user = new User({
      name,
      email,
      password,
      notificationSettings: {
        enabled: true,
        priorities: ["high", "medium"],
        reminderTime: 2,
      },
    });

    // Generate token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    await user.save();

    res.status(201).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        notificationSettings: user.notificationSettings,
      },
    });
  } catch (error) {
    console.error("Error in register:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("Login attempt for email:", email);

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      console.log("User not found with email:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }
    console.log("User found:", user.email);

    // Check password
    const isMatch = await user.comparePassword(password);
    console.log("Password match:", isMatch);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    console.log("Login successful for:", user.email);

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        notificationSettings: user.notificationSettings,
      },
    });
  } catch (error) {
    console.error("Error in login:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get current user
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    res.json(user);
  } catch (error) {
    console.error("Error in get user:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update settings
router.patch("/settings", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    user.notificationSettings = req.body.notificationSettings;
    await user.save();
    res.json(user.notificationSettings);
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get settings
router.get("/settings", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    res.json({ notificationSettings: user.notificationSettings });
  } catch (error) {
    console.error("Error getting settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get notification settings
router.get("/notification-settings", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(
      user.notificationSettings || {
        enabled: true,
        priorities: ["high", "medium"],
        reminderTime: 2,
      }
    );
  } catch (error) {
    console.error("Error getting notification settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update notification settings
router.put("/notification-settings", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.notificationSettings = {
      enabled: req.body.enabled,
      priorities: req.body.priorities,
      reminderTime: req.body.reminderTime,
    };

    await user.save();

    // Update scheduled notifications based on new settings
    const taskScheduler = req.app.get("taskScheduler");
    await taskScheduler.rescheduleAllNotifications(req.user.userId);

    res.json(user.notificationSettings);
  } catch (error) {
    console.error("Error updating notification settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get user's notifications
router.get("/notifications", auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (error) {
    console.error("Error getting notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Mark notification as read
router.patch("/notifications/:id", auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.userId },
      { read: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    res.json(notification);
  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Mark all notifications as read
router.post("/notifications/read-all", auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user.userId, read: false },
      { read: true }
    );
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create test user (development only)
router.post("/create-test-user", async (req, res) => {
  try {
    // Delete existing test user if any
    await User.deleteOne({ email: "test@example.com" });

    // Create new test user
    const user = new User({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
      notificationSettings: {
        enabled: true,
        priorities: ["high", "medium"],
        reminderTime: 2,
      },
    });

    await user.save();

    res.status(201).json({
      message: "Test user created successfully",
      credentials: {
        email: "test@example.com",
        password: "password123",
      },
    });
  } catch (error) {
    console.error("Error creating test user:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete test user (development only)
router.delete("/delete-test-user", async (req, res) => {
  try {
    await User.deleteOne({ email: "test@example.com" });
    res.json({ message: "Test user deleted successfully" });
  } catch (error) {
    console.error("Error deleting test user:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router; 