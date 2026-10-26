const mongoose = require('mongoose');

// إجابة الطالب عن مقياس الفائدة المدركة للتغذية الراجعة، الذي يُعرض إلزاميًا
// مرة واحدة بعد آخر سؤال في اختبار التغذية الراجعة وقبل عرض نتيجته.
// حلّ محل التقييم الثلاثي بعد كل سؤال (FeedbackRating، وبياناته القديمة باقية).
const answerSchema = new mongoose.Schema(
  {
    item: { type: Number, required: true },
    text: { type: String, default: '' },
    score: { type: Number, required: true },
    label: { type: String, default: '' },
  },
  { _id: false }
);

const usefulnessSurveySchema = new mongoose.Schema(
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

module.exports = mongoose.model('UsefulnessSurvey', usefulnessSurveySchema);
