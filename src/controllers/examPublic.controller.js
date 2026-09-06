const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { FEEDBACK_TYPE_LABELS } = require('../constants');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');
const Group = require('../models/Group');
const FeedbackRating = require('../models/FeedbackRating');

const getMeta = asyncHandler(async (req, res) => {
  const exam = await Exam.findOne({ code: req.params.code, isPublished: true }).populate({
    path: 'topic',
    populate: { path: 'chapter' },
  });

  if (!exam) {
    throw new ApiError(404, 'الاختبار غير موجود. تحقق من الرابط أو راجع المسؤول.');
  }

  const questionCount = await Question.countDocuments({ exam: exam._id });

  res.json({
    success: true,
    data: {
      title: exam.title,
      description: exam.description,
      code: exam.code,
      topic: exam.topic?.title,
      chapter: exam.topic?.chapter?.title,
      questionCount,
      attemptsPerQuestion: exam.attemptsPerQuestion,
      questionTimeSeconds: exam.questionTimeSeconds,
      feedbackType: exam.feedbackType,
    },
  });
});

const start = asyncHandler(async (req, res) => {
  const exam = await Exam.findOne({ code: req.params.code, isPublished: true });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود أو غير منشور');

  const completed = await Session.findOne({
    user: req.user._id,
    exam: exam._id,
    status: 'completed',
  });
  if (completed) {
    throw new ApiError(409, 'لقد أديت هذا الاختبار بالفعل. لا يمكنك إعادته مرة أخرى.');
  }

  let session = await Session.findOne({
    user: req.user._id,
    exam: exam._id,
    status: 'in-progress',
  });

  if (!session) {
    session = await Session.create({ user: req.user._id, exam: exam._id });
  }

  const questions = await Question.find({ exam: exam._id }).sort({ order: 1 });

  const ratings = await FeedbackRating.find({
    user: req.user._id,
    exam: exam._id,
  }).select('question');

  const sanitized = questions.map((q) => ({
    _id: q._id,
    order: q.order,
    text: q.text,
    image: q.image,
    options: q.options.map((o) => ({
      _id: o._id,
      text: o.text,
      image: o.image,
      isCorrect: o.isCorrect,
      correctExplanation: o.isCorrect ? o.correctExplanation || '' : '',
    })),
  }));

  res.json({
    success: true,
    data: {
      sessionId: session._id,
      examTitle: exam.title,
      examDescription: exam.description,
      attemptsPerQuestion: exam.attemptsPerQuestion,
      questionTimeSeconds: exam.questionTimeSeconds,
      questionCount: sanitized.length,
      questions: sanitized,
      ratedQuestions: ratings.map((r) => r.question),
    },
  });
});

const submit = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { questionId, optionId, timeTakenSeconds } = req.body;

  const exam = await Exam.findOne({ code, isPublished: true });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود أو غير منشور');

  const session = await Session.findOne({
    user: req.user._id,
    exam: exam._id,
    status: 'in-progress',
  });
  if (!session) {
    throw new ApiError(400, 'انتهت مهلة الاختبار. عد إلى البداية وابدأ من جديد.');
  }

  const question = await Question.findById(questionId);
  if (!question || String(question.exam) !== String(exam._id)) {
    throw new ApiError(400, 'هذا السؤال لا ينتمي إلى الاختبار');
  }

  const option = question.options.id(optionId);
  if (!option) throw new ApiError(400, 'الإجابة غير موجودة في هذا السؤال');

  let detail = session.details.find((d) => d.question && String(d.question) === String(questionId));
  if (detail && detail.isCorrect) {
    throw new ApiError(400, 'لقد أجبت عن هذا السؤال بشكل صحيح من قبل');
  }

  const attemptNumber = (detail?.attempts || 0) + 1;
  if (attemptNumber > exam.attemptsPerQuestion) {
    throw new ApiError(400, 'لا توجد محاولات متبقية لهذا السؤال');
  }

  const group = req.user.group ? await Group.findById(req.user.group) : null;
  const feedbackType = group?.feedbackType || exam.feedbackType;
  if (!session.feedbackType) session.feedbackType = feedbackType;

  const isCorrect = !!option.isCorrect;
  const seconds = Math.max(Number(timeTakenSeconds) || 0, 0);
  const isFirstTryCorrect = isCorrect && attemptNumber === 1;

  const payload = {
    question: questionId,
    attempts: (detail?.attempts || 0) + 1,
    isCorrect: detail?.isCorrect || isCorrect,
    correctAttempt: detail?.correctAttempt ?? (isCorrect ? attemptNumber : null),
    firstTryCorrect: (detail?.firstTryCorrect || false) || isFirstTryCorrect,
    totalTimeSeconds: (detail?.totalTimeSeconds || 0) + seconds,
  };

  if (detail) {
    detail.set(payload);
  } else {
    session.details.push({ question: questionId, ...payload });
  }

  let starsGained = 0;
  let badgeEarned = false;
  if (isCorrect) {
    session.correctCount += 1;
    starsGained = Math.max(4 - attemptNumber, 0);
    session.stars += starsGained;
    if (isFirstTryCorrect && !(detail?.firstTryCorrect)) {
      badgeEarned = true;
      session.badges += 1;
    }
  } else {
    session.wrongCount += 1;
  }

  await Attempt.create({
    user: req.user._id,
    session: session._id,
    exam: exam._id,
    question: questionId,
    optionId,
    isCorrect,
    attemptNumber,
    timeTakenSeconds: seconds,
    feedbackType,
    feedbackShown: !isCorrect,
  });

  await session.save();

  const attemptsLeft = Math.max(exam.attemptsPerQuestion - attemptNumber, 0);
  const exhausted = !isCorrect && attemptsLeft === 0;

  res.json({
    success: true,
    data: {
      isCorrect,
      attemptNumber,
      attemptsLeft,
      starsGained,
      badgeEarned,
      exhausted,
      feedback: isCorrect
        ? null
        : { type: feedbackType, label: FEEDBACK_TYPE_LABELS[feedbackType], content: option.feedback[feedbackType] || '' },
      serverTime: new Date().toISOString(),
    },
  });
});

const complete = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { totalTimeSeconds } = req.body;

  const exam = await Exam.findOne({ code });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const session = await Session.findOneAndUpdate(
    { user: req.user._id, exam: exam._id, status: 'in-progress' },
    {
      status: 'completed',
      completedAt: new Date(),
      totalTimeSeconds: Math.max(Number(totalTimeSeconds) || 0, 0),
    },
    { returnDocument: 'after' }
  );

  if (!session) throw new ApiError(400, 'لا يوجد اختبار نشط لإنهائه');

  await Exam.updateOne({ _id: exam._id }, { $inc: { completions: 1 } });

  const questionCount = await Question.countDocuments({ exam: exam._id });
  const skippedCount = Math.max(questionCount - (session.correctCount + session.wrongCount), 0);
  session.skippedCount = skippedCount;

  const attemptedQuestionIds = (session.details || [])
    .filter((d) => d.question && d.attempts > 0)
    .map((d) => d.question);
  if (attemptedQuestionIds.length > 0) {
    const rated = await FeedbackRating.find({
      user: req.user._id,
      exam: exam._id,
      question: { $in: attemptedQuestionIds },
    }).distinct('question');
    const missing = attemptedQuestionIds.filter(
      (id) => !rated.some((r) => String(r) === String(id))
    );
    if (missing.length > 0) {
      throw new ApiError(400, 'أكمل مقياس الفائدة المدركة للتغذية الراجعة أولًا');
    }
  }

  res.json({
    success: true,
    data: {
      sessionId: session._id,
      examTitle: exam.title,
      questionCount,
      correctCount: session.correctCount,
      wrongAttempts: session.wrongCount,
      skippedCount,
      stars: session.stars,
      badges: session.badges,
      feedbackType: session.feedbackType,
    },
  });
});

module.exports = { getMeta, start, submit, complete };