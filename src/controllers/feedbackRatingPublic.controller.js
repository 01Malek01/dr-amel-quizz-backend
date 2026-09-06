const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Session = require('../models/Session');
const FeedbackRating = require('../models/FeedbackRating');

const submit = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { questionId, item1, item2, item3 } = req.body;

  const exam = await Exam.findOne({ code, isPublished: true });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود أو غير منشور');

  const session = await Session.findOne({
    user: req.user._id,
    exam: exam._id,
    status: 'in-progress',
  });
  if (!session) throw new ApiError(400, 'لا يوجد اختبار نشط لتقييمه');

  const question = await Question.findById(questionId);
  if (!question || String(question.exam) !== String(exam._id)) {
    throw new ApiError(400, 'هذا السؤال لا ينتمي إلى الاختبار');
  }

  const items = [item1, item2, item3].map((v) => Number(v));
  if (items.some((v) => !Number.isInteger(v) || v < 1 || v > 5)) {
    throw new ApiError(400, 'يرجى اختيار استجابة واحدة لكل عبارة من 1 إلى 5');
  }

  let rating = await FeedbackRating.findOne({
    user: req.user._id,
    exam: exam._id,
    question: questionId,
  });

  if (rating) {
    return res.json({
      success: true,
      data: { ratingId: rating._id, score: rating.score, alreadyRated: true },
    });
  }

  const score = Math.round(((items[0] + items[1] + items[2]) / 3) * 100) / 100;

  rating = await FeedbackRating.create({
    user: req.user._id,
    exam: exam._id,
    session: session._id,
    question: questionId,
    item1: items[0],
    item2: items[1],
    item3: items[2],
    score,
  });

  res.json({
    success: true,
    data: { ratingId: rating._id, score, alreadyRated: false },
  });
});

module.exports = { submit };