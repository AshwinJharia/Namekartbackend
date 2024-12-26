const schedule = require('node-schedule');
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');

class TaskScheduler {
    constructor(io) {
        this.io = io;
        this.jobs = new Map();
    }

    // Initialize scheduler
    init() {
        // Check for overdue tasks every hour
        schedule.scheduleJob('0 * * * *', () => this.checkOverdueTasks());
        
        // Schedule daily digest at 9 AM
        schedule.scheduleJob('0 9 * * *', () => this.sendDailyDigest());
        
        console.log('Task scheduler initialized');
    }

    // Schedule notifications for a specific task
    async scheduleTaskNotifications(taskId) {
        try {
            const task = await Task.findById(taskId);
            const user = await User.findById(task.user);

            if (!task || !user) return;

            // Only schedule if notifications are enabled for this priority
            if (
                user.notificationPreferences.enabled &&
                user.notificationPreferences.priorityLevels[task.priority]
            ) {
                const deadlineDate = new Date(task.dueDate);
                deadlineDate.setHours(
                    deadlineDate.getHours() - user.notificationPreferences.timing.beforeDeadline
                );

                // Cancel existing job if any
                if (this.jobs.has(taskId)) {
                    this.jobs.get(taskId).cancel();
                }

                // Create notification
                const notification = new Notification({
                    user: task.user,
                    task: taskId,
                    type: 'deadline',
                    message: `Task "${task.title}" is due in ${user.notificationPreferences.timing.beforeDeadline} hours`,
                    scheduledFor: deadlineDate,
                });

                await notification.save();

                // Schedule notification
                const job = schedule.scheduleJob(deadlineDate, async () => {
                    notification.sent = true;
                    await notification.save();
                    this.io.to(task.user.toString()).emit('notification', notification);
                });

                this.jobs.set(taskId, job);
            }
        } catch (error) {
            console.error('Error scheduling task notifications:', error);
        }
    }

    // Check for overdue tasks
    async checkOverdueTasks() {
        try {
            const now = new Date();
            const tasks = await Task.find({
                status: 'pending',
                dueDate: { $lt: now }
            });

            for (const task of tasks) {
                // Update task status
                task.status = 'overdue';
                await task.save();

                const user = await User.findById(task.user);
                if (
                    user.notificationPreferences.enabled &&
                    user.notificationPreferences.timing.overdueReminders
                ) {
                    // Create overdue notification
                    const notification = new Notification({
                        user: task.user,
                        task: task._id,
                        type: 'overdue',
                        message: `Task "${task.title}" is overdue`,
                        scheduledFor: now,
                        sent: true
                    });

                    await notification.save();
                    this.io.to(task.user.toString()).emit('notification', notification);
                }
            }
        } catch (error) {
            console.error('Error checking overdue tasks:', error);
        }
    }

    // Send daily digest
    async sendDailyDigest() {
        try {
            const users = await User.find({
                'notificationPreferences.enabled': true,
                'notificationPreferences.timing.dailyDigest': true
            });

            for (const user of users) {
                const tasks = await Task.find({
                    user: user._id,
                    status: { $in: ['pending', 'overdue'] }
                }).sort({ dueDate: 1 });

                if (tasks.length > 0) {
                    const notification = new Notification({
                        user: user._id,
                        type: 'daily_digest',
                        message: this.createDigestMessage(tasks),
                        scheduledFor: new Date(),
                        sent: true
                    });

                    await notification.save();
                    this.io.to(user._id.toString()).emit('notification', notification);
                }
            }
        } catch (error) {
            console.error('Error sending daily digest:', error);
        }
    }

    // Create digest message
    createDigestMessage(tasks) {
        const overdueTasks = tasks.filter(task => task.status === 'overdue');
        const pendingTasks = tasks.filter(task => task.status === 'pending');
        
        return `Daily Task Summary:
        ${overdueTasks.length} overdue tasks
        ${pendingTasks.length} pending tasks for today
        Next deadline: ${pendingTasks[0]?.title} at ${new Date(pendingTasks[0]?.dueDate).toLocaleTimeString()}`;
    }

    // Cancel all scheduled jobs
    cancelAllJobs() {
        for (const job of this.jobs.values()) {
            job.cancel();
        }
        this.jobs.clear();
    }
}

module.exports = TaskScheduler; 