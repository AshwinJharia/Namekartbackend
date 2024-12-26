const schedule = require('node-schedule');
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');

class TaskScheduler {
  constructor() {
    this.jobs = new Map();
  }

  async init() {
    try {
      // Cancel existing jobs
      this.jobs.forEach(job => job.cancel());
      this.jobs.clear();

      // Schedule end-of-day overdue task check for all users
      this.scheduleOverdueTaskCheck();

      // Get all tasks and schedule notifications
      const tasks = await Task.find({}).populate('user');
      for (const task of tasks) {
        await this.scheduleTaskNotifications(task._id);
      }
      console.log('Task scheduler initialized');
    } catch (error) {
      console.error('Error initializing task scheduler:', error);
    }
  }

  scheduleOverdueTaskCheck() {
    // Schedule to run at 8:00 PM every day
    const job = schedule.scheduleJob('0 20 * * *', async () => {
      try {
        // Get all users with notifications enabled
        const users = await User.find({
          'notificationSettings.enabled': true
        });

        for (const user of users) {
          // Get overdue tasks for this user
          const overdueTasks = await Task.find({
            user: user._id,
            status: { $ne: 'completed' },
            dueDate: { $lt: new Date() }
          });

          if (overdueTasks.length > 0) {
            // Create notification for overdue tasks
            const notification = await Notification.create({
              user: user._id,
              type: 'overdue',
              message: `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}. Please review and update their status.`,
              read: false
            });

            // Send real-time notification
            if (global.io) {
              global.io.to(user._id.toString()).emit('notification', {
                _id: notification._id,
                type: 'overdue',
                message: notification.message,
                createdAt: notification.createdAt,
                read: false,
                tasks: overdueTasks.map(task => ({
                  _id: task._id,
                  title: task.title,
                  dueDate: task.dueDate,
                  priority: task.priority
                }))
              });
              console.log(`Sent overdue tasks notification to user ${user._id}`);
            }
          }
        }
      } catch (error) {
        console.error('Error checking overdue tasks:', error);
      }
    });

    this.jobs.set('overdueCheck', job);
    console.log('Scheduled daily overdue task check for 8:00 PM');
  }

  async scheduleTaskNotifications(taskId) {
    try {
      const task = await Task.findById(taskId).populate('user');
      if (!task) return;

      // Cancel existing jobs for this task
      if (this.jobs.has(taskId)) {
        this.jobs.get(taskId).cancel();
        this.jobs.delete(taskId);
      }

      // Get user's notification settings
      const user = await User.findById(task.user._id);
      if (!user?.notificationSettings?.enabled) return;
      if (!user.notificationSettings.priorities.includes(task.priority)) return;

      const dueDate = new Date(task.dueDate);
      const reminderTime = user.notificationSettings.reminderTime || 2; // default 2 hours
      const reminderDate = new Date(dueDate.getTime() - (reminderTime * 60 * 60 * 1000));

      // Don't schedule if the reminder time has already passed
      if (reminderDate <= new Date()) return;

      console.log(`Scheduling notification for task ${task.title} at ${reminderDate}`);

      // Schedule reminder notification
      const job = schedule.scheduleJob(reminderDate, async () => {
        try {
          // Create notification in database
          const notification = await Notification.create({
            user: task.user._id,
            task: task._id,
            type: 'reminder',
            message: `Task "${task.title}" is due in ${reminderTime} hours`,
            read: false
          });

          // Send real-time notification
          if (global.io) {
            global.io.to(task.user._id.toString()).emit('notification', {
              _id: notification._id,
              type: 'reminder',
              task: {
                _id: task._id,
                title: task.title,
                dueDate: task.dueDate,
                priority: task.priority
              },
              message: `Task "${task.title}" is due in ${reminderTime} hours`,
              createdAt: notification.createdAt,
              read: false
            });
            console.log(`Sent reminder notification for task ${task.title}`);
          } else {
            console.error('Socket.IO instance not found');
          }
        } catch (error) {
          console.error('Error sending notification:', error);
        }
      });

      this.jobs.set(taskId, job);
    } catch (error) {
      console.error('Error scheduling notifications:', error);
    }
  }

  async rescheduleAllNotifications(userId) {
    try {
      const tasks = await Task.find({ user: userId });
      for (const task of tasks) {
        await this.scheduleTaskNotifications(task._id);
      }
    } catch (error) {
      console.error('Error rescheduling notifications:', error);
    }
  }

  cancelTaskNotifications(taskId) {
    if (this.jobs.has(taskId)) {
      this.jobs.get(taskId).cancel();
      this.jobs.delete(taskId);
    }
  }
}

module.exports = TaskScheduler; 