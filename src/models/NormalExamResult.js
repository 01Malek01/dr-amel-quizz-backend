const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NormalQuestion',
      required: true,
    },
    chosenOption: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    isCorrect: { type: Boolean, required: true },
  },
  { _id: false }
);

const normalExamResultSchema = new mongoose.Schema(
  {
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NormalExam',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    answers: { type: [answerSchema], default: [] },
    correctCount: { type: Number, default: 0 },
    questionCount: { type: Number, default: 0 },
    grade: { type: Number, default: 0 },
    totalGrade: { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NormalExamResult', normalExamResultSchema);