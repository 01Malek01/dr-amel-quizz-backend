const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { generateExamCode } = require('../utils/code');
const Exam = require('../models/Exam');
const Topic = require('../models/Topic');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');
const FeedbackRating = require('../models/FeedbackRating');

const listExams = asyncHandler(async (req, res) => {
  const { topic = '', chapter = '', status = '', search = '' } = req.query;

  const filter = {};
  if (topic) filter.topic = topic;
  if (status === 'published') filter.isPublished = true;
  if (status === 'draft') filter.isPublished = false;
  if (search.trim()) filter.title = { $regex: search.trim(), $options: 'i' };

  let exams = await Exam.find(filter)
    .populate({ path: 'topic', populate: { path: 'chapter' } })
    .sort({ createdAt: -1 });

  if (chapter) {
    exams = exams.filter((e) => e.topic && String(e.topic.chapter?._id) === chapter);
  }

  const questionCounts = await Question.aggregate([
    { $match: { exam: { $in: exams.map((e) => e._id) } } },
    { $group: { _id: '$exam', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(questionCounts.map((q) => [String(q._id), q.count]));

  const data = exams.map((e) => ({
    ...e.toObject(),
    questionCount: countMap[String(e._id)] || 0,
    topicTitle: e.topic?.title || 'محذوف',
    chapterTitle: e.topic?.chapter?.title || '—',
    link: e.isPublished && e.code ? `/exam/${e.code}` : null,
  }));

  res.json({ success: true, data });
});

const getExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id).populate({
    path: 'topic',
    populate: { path: 'chapter' },
  });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = await Question.find({ exam: exam._id }).sort({ order: 1 });

  res.json({
    success: true,
    data: {
      ...exam.toObject(),
      topicTitle: exam.topic?.title || 'محذوف',
      chapterTitle: exam.topic?.chapter?.title || '—',
      link: exam.isPublished && exam.code ? `/exam/${exam.code}` : null,
      questionCount: questions.length,
      questions,
    },
  });
});

const createExam = asyncHandler(async (req, res) => {
  const { title, description, topic, feedbackType, attemptsPerQuestion, questionTimeSeconds } = req.body;

  if (!title) throw new ApiError(400, 'عنوان الاختبار مطلوب');
  if (!topic) throw new ApiError(400, 'اختر موضوعًا لهذا الاختبار');

  const topicDoc = await Topic.findById(topic);
  if (!topicDoc) throw new ApiError(404, 'الموضوع غير موجود');

  const exam = await Exam.create({
    title,
    description: description || '',
    topic,
    feedbackType: feedbackType || 'hint',
    attemptsPerQuestion: attemptsPerQuestion || 3,
    questionTimeSeconds: questionTimeSeconds !== undefined ? questionTimeSeconds : 90,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, data: exam });
});

const updateExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const { title, description, topic, feedbackType, attemptsPerQuestion, questionTimeSeconds } = req.body;
  if (title !== undefined) exam.title = title;
  if (description !== undefined) exam.description = description;
  if (topic !== undefined) exam.topic = topic;
  if (feedbackType !== undefined) exam.feedbackType = feedbackType;
  if (attemptsPerQuestion !== undefined) exam.attemptsPerQuestion = attemptsPerQuestion;
  if (questionTimeSeconds !== undefined) exam.questionTimeSeconds = questionTimeSeconds;

  await exam.save();
  res.json({ success: true, data: exam });
});

const publishExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questionCount = await Question.countDocuments({ exam: exam._id });
  if (questionCount === 0) {
    throw new ApiError(400, 'أضف سؤالًا واحدًا على الأقل قبل النشر');
  }

  if (!exam.code) {
    let code = generateExamCode();
    while (await Exam.findOne({ code })) code = generateExamCode();
    exam.code = code;
  }

  exam.isPublished = true;
  exam.publishedAt = exam.publishedAt || new Date();
  await exam.save();

  res.json({
    success: true,
    data: { ...exam.toObject(), questionCount, link: `/exam/${exam.code}` },
  });
});

const unpublishExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  exam.isPublished = false;
  await exam.save();

  res.json({ success: true, data: exam });
});

const deleteExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  await Attempt.deleteMany({ exam: exam._id });
  await Session.deleteMany({ exam: exam._id });
  await Question.deleteMany({ exam: exam._id });
  await FeedbackRating.deleteMany({ exam: exam._id });
  await exam.deleteOne();

  res.json({ success: true, message: 'تم حذف الاختبار وسجلاته' });
});

module.exports = {
  listExams,
  getExam,
  createExam,
  updateExam,
  publishExam,
  unpublishExam,
  deleteExam,
};