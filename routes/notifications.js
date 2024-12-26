const express = require('express');
const router = express.Router();
const schedule = require('node-schedule');
const Notification = require('../models/Notification');
const Task = require('../models/Task');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Get all notifications for a user
router.get('/', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (error) {
    console.error('Error getting notifications:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark notification as read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.userId },
      { read: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json(notification);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Schedule notifications for a task
router.post('/schedule', auth, async (req, res) => {
  try {
    const { taskId } = req.body;
    const task = await Task.findById(taskId);
    const user = await User.findById(req.user.userId);

    if (!task || !user) {
      return res.status(404).json({ message: 'Task or user not found' });
    }

    // Only schedule if notifications are enabled and priority level is enabled
    if (
      user.notificationPreferences.enabled &&
      user.notificationPreferences.priorityLevels[task.priority]
    ) {
      // Schedule deadline notification
      const deadlineDate = new Date(task.dueDate);
      deadlineDate.setHours(
        deadlineDate.getHours() - user.notificationPreferences.timing.beforeDeadline
      );

      const notification = new Notification({
        user: req.user.userId,
        task: taskId,
        type: 'deadline',
        message: `Task "${task.title}" is due in ${user.notificationPreferences.timing.beforeDeadline} hours`,
        scheduledFor: deadlineDate,
      });

      await notification.save();

      // Schedule the notification using node-schedule
      schedule.scheduleJob(deadlineDate, async () => {
        notification.sent = true;
        await notification.save();
        // Emit socket event (handled in server.js)
        req.app.get('io').to(req.user.userId).emit('notification', notification);
      });
    }

    res.json({ message: 'Notifications scheduled' });
  } catch (error) {
    console.error('Error scheduling notifications:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Schedule daily digest
router.post('/schedule-digest', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user.notificationPreferences.enabled || !user.notificationPreferences.timing.dailyDigest) {
      return res.json({ message: 'Daily digest not enabled' });
    }

    // Schedule for 9 AM next day
    const scheduleDate = new Date();
    scheduleDate.setDate(scheduleDate.getDate() + 1);
    scheduleDate.setHours(9, 0, 0, 0);

    const tasks = await Task.find({
      user: req.user.userId,
      status: { $in: ['pending', 'overdue'] },
    });

    const notification = new Notification({
      user: req.user.userId,
      type: 'daily_digest',
      message: `You have ${tasks.length} pending tasks for today`,
      scheduledFor: scheduleDate,
    });

    await notification.save();

    // Schedule the notification
    schedule.scheduleJob(scheduleDate, async () => {
      notification.sent = true;
      await notification.save();
      req.app.get('io').to(req.user.userId).emit('notification', notification);
    });

    res.json({ message: 'Daily digest scheduled' });
  } catch (error) {
    console.error('Error scheduling daily digest:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 