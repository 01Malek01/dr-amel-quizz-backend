const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { escapeRegex } = require('../utils/escapeRegex');
const { generateExamCode } = require('../utils/code');
const Exam = require('../models/Exam');
const Topic = require('../models/Topic');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');
const User = require('../models/User');
const PostExamSurvey = require('../models/PostExamSurvey');
const UsefulnessSurvey = require('../models/UsefulnessSurvey');
const FeedbackRating = require('../models/FeedbackRating');

const listExams = asyncHandler(async (req, res) => {
  const { topic = '', chapter = '', status = '', search = '' } = req.query;

  const filter = {};
  if (topic) filter.topic = topic;
  if (status === 'published') filter.isPublished = true;
  if (status === 'draft') filter.isPublished = false;
  if (search.trim()) filter.title = { $regex: escapeRegex(search.trim()), $options: 'i' };

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
  const exam = await Exam.findById(req.params.id)
    .populate({ path: 'topic', populate: { path: 'chapter' } })
    .populate({ path: 'lateAccessUsers', select: 'name username' });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const [questions, completedCount, inProgressCount] = await Promise.all([
    Question.find({ exam: exam._id }).sort({ order: 1 }),
    // عدد من أنهوا الاختبار ومن بدؤوه دون إنهاء، لعرضهما أعلى صفحة الاختبار
    Session.countDocuments({ exam: exam._id, status: 'completed' }),
    Session.countDocuments({ exam: exam._id, status: 'in-progress' }),
  ]);

  res.json({
    success: true,
    data: {
      ...exam.toObject(),
      completedCount,
      inProgressCount,
      topicTitle: exam.topic?.title || 'محذوف',
      chapterTitle: exam.topic?.chapter?.title || '—',
      link: exam.isPublished && exam.code ? `/exam/${exam.code}` : null,
      questionCount: questions.length,
      questions,
    },
  });
});

const createExam = asyncHandler(async (req, res) => {
  const { title, description, topic, feedbackType, attemptsPerQuestion, questionTimeSeconds, showScoreHistory } = req.body;

  if (!title) throw new ApiError(400, 'عنوان الاختبار مطلوب');
  if (!topic) throw new ApiError(400, 'اختر موضوعًا لهذا الاختبار');

  const topicDoc = await Topic.findById(topic);
  if (!topicDoc) throw new ApiError(404, 'الموضوع غير موجود');

  const exam = await Exam.create({
    title,
    description: description || '',
    topic,
    feedbackType: feedbackType || 'hint',
    attemptsPerQuestion: attemptsPerQuestion || 2,
    questionTimeSeconds: questionTimeSeconds !== undefined ? questionTimeSeconds : 90,
    showScoreHistory: !!showScoreHistory,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, data: exam });
});

const updateExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const { title, description, topic, feedbackType, attemptsPerQuestion, questionTimeSeconds, showScoreHistory } = req.body;
  if (title !== undefined) exam.title = title;
  if (description !== undefined) exam.description = description;
  if (topic !== undefined) exam.topic = topic;
  if (feedbackType !== undefined) exam.feedbackType = feedbackType;
  if (attemptsPerQuestion !== undefined) exam.attemptsPerQuestion = attemptsPerQuestion;
  if (questionTimeSeconds !== undefined) exam.questionTimeSeconds = questionTimeSeconds;
  if (showScoreHistory !== undefined) exam.showScoreHistory = !!showScoreHistory;

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
  // إجابات المقياسين كانت تبقى بعد حذف الاختبار
  await UsefulnessSurvey.deleteMany({ exam: exam._id });
  await PostExamSurvey.deleteMany({ exam: exam._id });
  await exam.deleteOne();

  res.json({ success: true, message: 'تم حذف الاختبار وسجلاته' });
});

// فتح اختبار مغلق لطالب واحد تأخّر عن موعده المعلن
const grantLateAccess = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');
  if (!exam.code) {
    throw new ApiError(400, 'انشر الاختبار أولًا ليصبح له رابط يمكن مشاركته');
  }

  const student = await User.findById(req.body.userId).select('name username role');
  if (!student || student.role !== 'student') throw new ApiError(404, 'الطالب غير موجود');

  const done = await Session.findOne({ user: student._id, exam: exam._id, status: 'completed' });
  if (done) throw new ApiError(409, 'أدى هذا الطالب الاختبار بالفعل، ولا يمكن إعادته له');

  if (!exam.lateAccessUsers.some((id) => String(id) === String(student._id))) {
    exam.lateAccessUsers.push(student._id);
    await exam.save();
  }

  await exam.populate({ path: 'lateAccessUsers', select: 'name username' });
  res.json({ success: true, data: exam.lateAccessUsers });
});

const revokeLateAccess = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  exam.lateAccessUsers = exam.lateAccessUsers.filter(
    (id) => String(id) !== String(req.params.userId)
  );
  await exam.save();

  await exam.populate({ path: 'lateAccessUsers', select: 'name username' });
  res.json({ success: true, data: exam.lateAccessUsers });
});

// سجلات الطلاب في اختبار: جلسة لكل طالب، منتهية أو قيد التقدم
const listSessions = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id).select('_id');
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const [sessions, questionCount] = await Promise.all([
    Session.find({ exam: exam._id })
      .populate({ path: 'user', select: 'name nationalId group', populate: { path: 'group', select: 'name' } })
      .sort({ startedAt: -1 }),
    Question.countDocuments({ exam: exam._id }),
  ]);

  const sessionIds = sessions.map((s) => s._id);
  const [usefulDone, postDone] = await Promise.all([
    UsefulnessSurvey.distinct('session', { session: { $in: sessionIds } }),
    PostExamSurvey.distinct('session', { session: { $in: sessionIds } }),
  ]);
  const usefulSet = new Set(usefulDone.map(String));
  const postSet = new Set(postDone.map(String));

  res.json({
    success: true,
    data: sessions.map((s) => ({
      sessionId: s._id,
      studentId: s.user?._id || null,
      studentName: s.user?.name || 'محذوف',
      nationalId: s.user?.nationalId || '',
      group: s.user?.group?.name || null,
      status: s.status,
      correctCount: s.correctCount,
      questionCount,
      answeredCount: (s.details || []).length,
      badges: s.badges || 0,
      skippedCount: s.skippedCount || 0,
      totalTimeSeconds: s.totalTimeSeconds || 0,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      usefulnessDone: usefulSet.has(String(s._id)),
      postSurveyDone: postSet.has(String(s._id)),
      questionsFinished: !!s.questionsFinishedAt,
    })),
  });
});

/*
 * حذف سجل طالب في اختبار تغذية راجعة، ليعيده من البداية.
 * يُحذف معه كل ما يخص هذه المحاولة: الإجابات، وتقييمات مقياس الفائدة المدركة
 * (فريدة لكل طالب وسؤال، فبقاؤها يُفشل تقييم الإعادة أو يتخطاه)، والمقياس البعدي.
 */
const deleteSession = asyncHandler(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.sessionId, exam: req.params.id });
  if (!session) throw new ApiError(404, 'السجل غير موجود في هذا الاختبار');

  await Promise.all([
    Attempt.deleteMany({ session: session._id }),
    FeedbackRating.deleteMany({ user: session.user, exam: session.exam }),
    PostExamSurvey.deleteMany({ session: session._id }),
    UsefulnessSurvey.deleteMany({ session: session._id }),
  ]);
  if (session.status === 'completed') {
    await Exam.updateOne(
      { _id: session.exam, completions: { $gt: 0 } },
      { $inc: { completions: -1 } }
    );
  }
  await session.deleteOne();

  res.json({ success: true, message: 'تم حذف السجل. يستطيع الطالب أداء الاختبار من جديد.' });
});

module.exports = {
  listExams,
  getExam,
  createExam,
  updateExam,
  publishExam,
  unpublishExam,
  deleteExam,
  grantLateAccess,
  revokeLateAccess,
  listSessions,
  deleteSession,
};