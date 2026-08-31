const mongoose = require('mongoose');

const attemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
      index: true,
    },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: true,
      index: true,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
      index: true,
    },
    optionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    isCorrect: { type: Boolean, required: true },
    attemptNumber: { type: Number, required: true },
    timeTakenSeconds: { type: Number, default: 0 },
    feedbackType: { type: String, default: null },
    feedbackShown: { type: Boolean, default: true },
  },
  { timestamps: true }
);

attemptSchema.index({ user: 1, session: 1 });

module.exports = mongoose.model('Attempt', attemptSchema);