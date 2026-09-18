const mongoose = require('mongoose');

// إجابة الطالب عن المقياس البعدي (مقياس الانفعالات المرتبط بأداء الاختبار)
// الذي يُعرض إلزاميًا بعد آخر سؤال في اختبار التغذية الراجعة.
const answerSchema = new mongoose.Schema(
  {
    item: { type: Number, required: true }, // ترتيب البند 0..7
    text: { type: String, default: '' },
    score: { type: Number, required: true },
    label: { type: String, default: '' },
  },
  { _id: false }
);

const postExamSurveySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    // جلسة واحدة = إجابة واحدة
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
      unique: true,
    },
    answers: { type: [answerSchema], default: [] },
    totalScore: { type: Number, default: 0 },
    itemCount: { type: Number, default: 0 },
    result: { type: Number, default: 0 },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PostExamSurvey', postExamSurveySchema);
