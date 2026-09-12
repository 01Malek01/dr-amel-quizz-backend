const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SurveyQuestion',
      required: true,
    },
    choiceLabel: { type: String, default: '' },
    score: { type: Number, required: true },
  },
  { _id: false }
);

const surveyResponseSchema = new mongoose.Schema(
  {
    survey: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Survey',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
    questionOrder: {
      type: Number,
      default: null,
    },
    source: {
      type: String,
      enum: ['standalone', 'in-test'],
      default: 'standalone',
    },
    answers: { type: [answerSchema], default: [] },
    totalScore: { type: Number, default: 0 },
    questionCount: { type: Number, default: 0 },
    result: { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

surveyResponseSchema.index({ survey: 1, user: 1 });
surveyResponseSchema.index({ survey: 1, session: 1, questionOrder: 1 });

module.exports = mongoose.model('SurveyResponse', surveyResponseSchema);