const mongoose = require('mongoose');

const detailSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      default: null,
    },
    attempts: { type: Number, default: 0 },
    correctAttempt: { type: Number, default: null },
    isCorrect: { type: Boolean, default: false },
    totalTimeSeconds: { type: Number, default: 0 },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['in-progress', 'completed'],
      default: 'in-progress',
    },
    feedbackType: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    totalTimeSeconds: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    stars: { type: Number, default: 0 },
    details: { type: [detailSchema], default: [] },
  },
  { timestamps: true }
);

sessionSchema.index({ user: 1, exam: 1, status: 1 });

module.exports = mongoose.model('Session', sessionSchema);