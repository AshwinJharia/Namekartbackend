const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Task = require('../models/Task');
const auth = require('../middleware/auth');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Get all tasks for a user
router.get('/', auth, async (req, res) => {
  try {
    const tasks = await Task.find({ user: req.user.userId }).sort({ dueDate: 1 });
    res.json(tasks);
  } catch (error) {
    console.error('Error getting tasks:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new task
router.post('/', auth, async (req, res) => {
  try {
    const task = new Task({
      ...req.body,
      user: req.user.userId,
    });

    // Get AI suggestions for the task
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });
      const prompt = `Given this task:
Title: ${task.title}
Description: ${task.description || 'No description provided'}
Due Date: ${new Date(task.dueDate).toLocaleString()}
Priority: ${task.priority}

Provide 2-3 concise, actionable suggestions to help complete this task efficiently. Format your response as a JSON array of strings. Example:
["Break down the task into smaller steps", "Set reminders for key milestones"]`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      console.log('AI Response:', text); // Debug log

      try {
        const suggestions = JSON.parse(text);
        if (Array.isArray(suggestions)) {
          task.aiSuggestions = suggestions;
        } else {
          task.aiSuggestions = ["Break down the task into smaller steps", "Set reminders for key milestones"];
        }
      } catch (parseError) {
        console.error('Error parsing AI suggestions:', parseError);
        // Set default suggestions if parsing fails
        task.aiSuggestions = ["Break down the task into smaller steps", "Set reminders for key milestones"];
      }
    } catch (aiError) {
      console.error('Error getting AI suggestions:', aiError);
      // Set default suggestions if AI generation fails
      task.aiSuggestions = ["Break down the task into smaller steps", "Set reminders for key milestones"];
    }

    await task.save();

    // Schedule notifications for the task
    const taskScheduler = req.app.get('taskScheduler');
    await taskScheduler.scheduleTaskNotifications(task._id);

    // Notify connected clients about the new task
    req.app.get('io').to(req.user.userId).emit('taskCreated', task);

    res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a task
router.put('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, user: req.user.userId },
      req.body,
      { new: true }
    );
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Reschedule notifications if due date or priority changed
    if (req.body.dueDate || req.body.priority) {
      const taskScheduler = req.app.get('taskScheduler');
      await taskScheduler.scheduleTaskNotifications(task._id);
    }

    // Notify connected clients about the task update
    req.app.get('io').to(req.user.userId).emit('taskUpdated', task);

    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update task status
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, user: req.user.userId },
      {
        status,
        completedAt: status === 'completed' ? new Date() : null,
      },
      { new: true }
    );
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Notify connected clients about the status update
    req.app.get('io').to(req.user.userId).emit('taskUpdated', task);

    res.json(task);
  } catch (error) {
    console.error('Error updating task status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a task
router.delete('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({
      _id: req.params.id,
      user: req.user.userId,
    });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Cancel any scheduled notifications
    const taskScheduler = req.app.get('taskScheduler');
    const jobs = taskScheduler.jobs;
    if (jobs.has(req.params.id)) {
      jobs.get(req.params.id).cancel();
      jobs.delete(req.params.id);
    }

    // Notify connected clients about the task deletion
    req.app.get('io').to(req.user.userId).emit('taskDeleted', task._id);

    res.json({ message: 'Task deleted' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get AI insights for productivity
router.get('/insights', auth, async (req, res) => {
  try {
    const tasks = await Task.find({ user: req.user.userId });
    
    const completedTasks = tasks.filter(task => task.status === 'completed');
    const overdueTasks = tasks.filter(task => {
      const dueDate = new Date(task.dueDate);
      return task.status !== 'completed' && dueDate < new Date();
    });
    
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const prompt = `Based on this task data:
    - Total tasks: ${tasks.length}
    - Completed tasks: ${completedTasks.length}
    - Overdue tasks: ${overdueTasks.length}
    - Average completion time: ${calculateAverageCompletionTime(completedTasks)} hours

    Provide 3 insights about productivity and 3 suggestions for improvement. Return ONLY a JSON object in this exact format:
    {
      "insights": ["insight1", "insight2", "insight3"],
      "suggestions": ["suggestion1", "suggestion2", "suggestion3"]
    }`;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      try {
        const insights = JSON.parse(response.text());
        res.json(insights);
      } catch (parseError) {
        console.error('Error parsing AI insights:', parseError);
        // Return default insights if parsing fails
        res.json({
          insights: [
            "You have some tasks that need attention",
            "Some tasks are overdue and require immediate action",
            "Task completion rate could be improved"
          ],
          suggestions: [
            "Focus on completing overdue tasks first",
            "Break down complex tasks into smaller steps",
            "Set realistic deadlines for new tasks"
          ]
        });
      }
    } catch (aiError) {
      console.error('Error getting AI insights:', aiError);
      throw new Error('Failed to generate AI insights');
    }
  } catch (error) {
    console.error('Error getting insights:', error);
    res.status(500).json({ message: 'Failed to get insights' });
  }
});

function calculateAverageCompletionTime(tasks) {
  if (tasks.length === 0) return 0;
  
  const totalHours = tasks.reduce((sum, task) => {
    if (task.completedAt && task.createdAt) {
      const diff = task.completedAt - task.createdAt;
      return sum + (diff / (1000 * 60 * 60));
    }
    return sum;
  }, 0);
  
  return Math.round(totalHours / tasks.length);
}

module.exports = router; 