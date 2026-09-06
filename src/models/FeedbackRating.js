const mongoose = require('mongoose');

const feedbackRatingSchema = new mongoose.Schema(
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
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
    },
    item1: { type: Number, required: true, min: 1, max: 5 },
    item2: { type: Number, required: true, min: 1, max: 5 },
    item3: { type: Number, required: true, min: 1, max: 5 },
    score: { type: Number, min: 1, max: 5 },
  },
  { timestamps: true }
);

feedbackRatingSchema.index({ user: 1, exam: 1, question: 1 }, { unique: true });

module.exports = mongoose.model('FeedbackRating', feedbackRatingSchema);