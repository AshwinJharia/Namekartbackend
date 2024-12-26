const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    dueDate: {
        type: Date,
        required: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'overdue'],
        default: 'pending'
    },
    category: {
        type: String,
        default: 'general'
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    completedAt: {
        type: Date
    },
    aiSuggestions: [{
        type: String
    }],
    reminderTime: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for faster queries
taskSchema.index({ user: 1, dueDate: 1 });
taskSchema.index({ status: 1, user: 1 });

module.exports = mongoose.model('Task', taskSchema); 