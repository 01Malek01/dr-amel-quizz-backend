const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { FEEDBACK_TYPE_LABELS } = require('../constants');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');
const Group = require('../models/Group');
const FeedbackRating = require('../models/FeedbackRating');
const Setting = require('../models/Setting');
const Survey = require('../models/Survey');
const SurveyQuestion = require('../models/SurveyQuestion');
const SurveyResponse = require('../models/SurveyResponse');

const getMeta = asyncHandler(async (req, res) => {
  const exam = await Exam.findOne({ code: req.params.code, isPublished: true }).populate({
    path: 'topic',
    populate: { path: 'chapter' },
  });

  if (!exam) {
    throw new ApiError(404, 'الاختبار غير موجود. تحقق من الرابط أو راجع المسؤول.');
  }

  const questionCount = await Question.countDocuments({ exam: exam._id });

  const linkedSurvey = await Survey.findOne({ exam: exam._id, isActive: true })
    .select('code title intro choices')
    .lean();

  let surveyQuestions = [];
  if (linkedSurvey) {
    surveyQuestions = await SurveyQuestion.find({ survey: linkedSurvey._id })
      .sort({ order: 1 })
      .lean();
  }

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
      showScoreHistory: exam.showScoreHistory,
      feedbackType: exam.feedbackType,
      instructions: await Setting.get('feedbackExamInstructions'),
      survey:
        linkedSurvey && surveyQuestions.length > 0 && (linkedSurvey.choices || []).length >= 2
          ? {
              code: linkedSurvey.code,
              title: linkedSurvey.title,
              intro: linkedSurvey.intro,
              questionCount: surveyQuestions.length,
              questions: surveyQuestions.map((q) => ({ _id: q._id, text: q.text })),
              choices: (linkedSurvey.choices || []).map((c) => ({
                _id: c._id,
                label: c.label,
                score: c.score,
              })),
            }
          : null,
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

  const activeSurvey = await Survey.findOne({ exam: exam._id, isActive: true }).select('_id').lean();
  let surveyedQuestions = [];
  if (activeSurvey) {
    const surveyResponses = await SurveyResponse.find({
      survey: activeSurvey._id,
      session: session._id,
      source: 'in-test',
    }).select('questionOrder -_id');
    surveyedQuestions = surveyResponses
      .map((r) => r.questionOrder)
      .filter((o) => o !== null && o !== undefined);
  }

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
      showScoreHistory: exam.showScoreHistory,
      questionCount: sanitized.length,
      questions: sanitized,
      ratedQuestions: ratings.map((r) => r.question),
      surveyedQuestions,
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

  // لا يوجد نظام نجوم — المكافأة الوحيدة لكل سؤال هي شارة المحاولة الأولى
  let badgeEarned = false;
  if (isCorrect) {
    session.correctCount += 1;
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

  const session = await Session.findOne({
    user: req.user._id,
    exam: exam._id,
    status: 'in-progress',
  });

  if (!session) throw new ApiError(400, 'لا يوجد اختبار نشط لإنهائه');

  // يجب التحقق من التقييمات قبل أي تعديل على الجلسة: لو أُنهيت الجلسة أولًا ثم
  // رُفض الطلب، يبقى الطالب عالقًا — لا يستطيع التقييم ولا الإنهاء ولا الإعادة.
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

  const questionCount = await Question.countDocuments({ exam: exam._id });
  const skippedCount = Math.max(questionCount - (session.correctCount + session.wrongCount), 0);

  session.set({
    status: 'completed',
    completedAt: new Date(),
    totalTimeSeconds: Math.max(Number(totalTimeSeconds) || 0, 0),
    skippedCount,
  });
  await session.save();

  await Exam.updateOne({ _id: exam._id }, { $inc: { completions: 1 } });

  let history = null;
  if (exam.showScoreHistory) {
    const pastSessions = await Session.find({ user: req.user._id, status: 'completed' })
      .populate({ path: 'exam', select: 'title' })
      .sort({ completedAt: -1 });
    const examIds = pastSessions.map((s) => s.exam?._id).filter(Boolean);
    const counts = await Question.aggregate([
      { $match: { exam: { $in: examIds } } },
      { $group: { _id: '$exam', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
    history = pastSessions.map((s) => {
      const qCount = countMap[String(s.exam?._id)] || 0;
      return {
        sessionId: s._id,
        examId: s.exam?._id,
        examTitle: s.exam?.title || 'اختبار محذوف',
        questionCount: qCount,
        correctCount: s.correctCount,
        wrongCount: s.wrongCount,
        skippedCount: s.skippedCount || 0,
        timeSeconds: s.totalTimeSeconds || 0,
        badges: s.badges || 0,
        completedAt: s.completedAt,
      };
    });
  }

  res.json({
    success: true,
    data: {
      sessionId: session._id,
      examTitle: exam.title,
      showScoreHistory: exam.showScoreHistory,
      history,
      questionCount,
      correctCount: session.correctCount,
      wrongAttempts: session.wrongCount,
      skippedCount,
      badges: session.badges,
      feedbackType: session.feedbackType,
    },
  });
});

const submitInTestSurvey = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { questionId, questionOrder, answers } = req.body;

  const exam = await Exam.findOne({ code, isPublished: true });
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const session = await Session.findOne({
    user: req.user._id,
    exam: exam._id,
    status: 'in-progress',
  });
  if (!session) throw new ApiError(400, 'لا يوجد اختبار نشط');

  const survey = await Survey.findOne({ exam: exam._id, isActive: true });
  if (!survey) throw new ApiError(404, 'لا يوجد مقياس نشط لهذا الاختبار');

  const existing = await SurveyResponse.findOne({
    survey: survey._id,
    session: session._id,
    questionOrder,
  });
  if (existing) {
    return res.json({ success: true, data: { alreadySubmitted: true } });
  }

  const surveyQuestions = await SurveyQuestion.find({ survey: survey._id }).sort({ order: 1 });
  if (surveyQuestions.length === 0) throw new ApiError(400, 'لا توجد بنود في المقياس');

  const cleanAnswers = Array.isArray(answers) ? answers : [];
  if (cleanAnswers.length !== surveyQuestions.length) {
    throw new ApiError(400, 'يجب الإجابة على جميع بنود المقياس');
  }

  const choicesMap = new Map(survey.choices.map((c) => [String(c._id), c]));
  let totalScore = 0;
  const answerDocs = [];

  for (const q of surveyQuestions) {
    const chosen = cleanAnswers.find(
      (a) => a && a.questionId && String(a.questionId) === String(q._id)
    );
    if (!chosen || !chosen.choiceId) {
      throw new ApiError(400, 'أجب على جميع بنود المقياس قبل التسليم');
    }
    const choice = choicesMap.get(String(chosen.choiceId));
    if (!choice) throw new ApiError(400, 'اختيار غير صحيح في أحد بنود المقياس');

    totalScore += choice.score;
    answerDocs.push({
      question: q._id,
      choiceLabel: choice.label,
      score: choice.score,
    });
  }

  const questionCount = surveyQuestions.length;
  const result = questionCount ? Math.round((totalScore / questionCount) * 100) / 100 : 0;

  await SurveyResponse.create({
    survey: survey._id,
    user: req.user._id,
    session: session._id,
    questionOrder,
    source: 'in-test',
    answers: answerDocs,
    totalScore,
    questionCount,
    result,
    submittedAt: new Date(),
  });

  res.status(201).json({
    success: true,
    data: { totalScore, questionCount, result },
  });
});

module.exports = { getMeta, start, submit, complete, submitInTestSurvey };