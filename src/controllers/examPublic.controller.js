const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { FEEDBACK_TYPE_LABELS, POST_EXAM_SURVEY, USEFULNESS_SURVEY } = require('../constants');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');
const Group = require('../models/Group');
const UsefulnessSurvey = require('../models/UsefulnessSurvey');
const PostExamSurvey = require('../models/PostExamSurvey');
const Setting = require('../models/Setting');

const hasLateAccess = (exam, user) =>
  !!user && (exam.lateAccessUsers || []).some((id) => String(id) === String(user._id));

// الاختبار متاح للطالب إن كان منشورًا، أو إن فتحه له المسؤول استثناءً بعد إغلاقه
const findOpenExam = async (code, user) => {
  const exam = await Exam.findOne({ code });
  if (!exam) return null;
  return exam.isPublished || hasLateAccess(exam, user) ? exam : null;
};

const CLOSED_MESSAGE =
  'الاختبار غير متاح حاليًا. تحقق من الرابط، وإن كان أستاذك قد فتحه لك فسجّل الدخول برقمك الوطني.';

/*
 * ترتيب نهاية الاختبار:
 *   آخر سؤال ← مقياس الفائدة المدركة (إلزامي، وبه يُسلَّم الاختبار)
 *   ← عرض النتيجة ← المقياس البعدي (إلزامي، وبه تُسجَّل النتيجة).
 * بين النتيجة والمقياس البعدي تبقى الجلسة «قيد التقدم» مع questionsFinishedAt.
 * من بلغ هذه المرحلة يُعاد إلى المقياس عند عودته، حتى لو أُغلق الاختبار في الأثناء.
 */
const awaitingPostSurvey = async (exam, user) => {
  if (!exam || !user) return null;
  return Session.findOne({
    user: user._id,
    exam: exam._id,
    status: 'in-progress',
    questionsFinishedAt: { $ne: null },
  });
};

const surveyPayload = (definition, title = definition.title) => ({
  title,
  intro: definition.intro,
  items: definition.items,
  choices: definition.choices,
});

const postSurveyPayload = () =>
  surveyPayload(POST_EXAM_SURVEY, `المقياس البعدي — ${POST_EXAM_SURVEY.title}`);

const getMeta = asyncHandler(async (req, res) => {
  let exam = await findOpenExam(req.params.code, req.user);
  if (!exam) {
    const closed = await Exam.findOne({ code: req.params.code });
    if (await awaitingPostSurvey(closed, req.user)) exam = closed;
  }

  if (!exam) {
    throw new ApiError(404, CLOSED_MESSAGE);
  }

  await exam.populate({ path: 'topic', populate: { path: 'chapter' } });

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
      showScoreHistory: exam.showScoreHistory,
      feedbackType: exam.feedbackType,
      instructions: await Setting.get('feedbackExamInstructions'),
    },
  });
});

const start = asyncHandler(async (req, res) => {
  let exam = await findOpenExam(req.params.code, req.user);
  if (!exam) {
    const closed = await Exam.findOne({ code: req.params.code });
    if (await awaitingPostSurvey(closed, req.user)) exam = closed;
  }
  if (!exam) throw new ApiError(404, CLOSED_MESSAGE);

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

  const [usefulnessDone, postSurveyDone] = await Promise.all([
    UsefulnessSurvey.exists({ session: session._id }).then(Boolean),
    PostExamSurvey.exists({ session: session._id }).then(Boolean),
  ]);

  // حالة كل سؤال في الجلسة، ليستأنف الطالب من حيث توقف إن أعاد تحميل الصفحة.
  // بدونها تبدأ الصفحة من السؤال الأول، فيرفض الخادم إعادة إجابة ما حُسم،
  // وتنتقل الصفحة دون تقييم — ثم يرفض الإنهاء لغياب التقييم فيعلق الطالب.
  const detailByQuestion = new Map(
    (session.details || [])
      .filter((d) => d.question)
      .map((d) => [String(d.question), d])
  );
  const lastWrongByQuestion = new Map();
  const wrongAttempts = await Attempt.find({ session: session._id, isCorrect: false }).sort({
    createdAt: 1,
  });
  for (const a of wrongAttempts) lastWrongByQuestion.set(String(a.question), a);

  const progress = questions.map((q) => {
    const id = String(q._id);
    const detail = detailByQuestion.get(id);
    const attempts = detail?.attempts || 0;
    const isCorrect = !!detail?.isCorrect;
    const exhausted = !isCorrect && attempts >= exam.attemptsPerQuestion;

    // التغذية الراجعة لآخر إجابة خاطئة، لإعادة عرضها كما رآها الطالب
    let lastFeedback = null;
    const lastWrong = lastWrongByQuestion.get(id);
    if (lastWrong && !isCorrect) {
      const option = q.options.id(lastWrong.optionId);
      if (option) {
        lastFeedback = {
          optionId: String(lastWrong.optionId),
          type: lastWrong.feedbackType,
          label: FEEDBACK_TYPE_LABELS[lastWrong.feedbackType],
          content: option.feedback?.[lastWrong.feedbackType] || '',
        };
      }
    }

    // سؤال أجاب عنه صحيحًا: تعود الإجابة وتعليقها لإعادة عرضهما بعد التحميل
    const correct = isCorrect ? q.options.find((o) => o.isCorrect) : null;

    return {
      questionId: q._id,
      attempts,
      attemptsLeft: Math.max(exam.attemptsPerQuestion - attempts, 0),
      isCorrect,
      exhausted,
      lastFeedback,
      ...(correct
        ? { correctOptionId: correct._id, correctExplanation: correct.correctExplanation || '' }
        : {}),
    };
  });

  const sanitized = questions.map((q) => ({
    _id: q._id,
    order: q.order,
    text: q.text,
    image: q.image,
    // لا تُرسل الإجابة الصحيحة ولا تعليقها مع الأسئلة: كانت تظهر لأي طالب يفتح
    // أدوات المطوّر في المتصفح. تُرسل فقط بعد أن يجيب عن السؤال صحيحًا.
    options: q.options.map((o) => ({
      _id: o._id,
      text: o.text,
      image: o.image,
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
      progress,
      // إلزامي بعد آخر سؤال وقبل النتيجة
      usefulnessSurvey: surveyPayload(USEFULNESS_SURVEY),
      usefulnessDone,
      // إلزامي بعد عرض النتيجة، وبه تُسجَّل
      postSurvey: postSurveyPayload(),
      postSurveyDone,
      // رأى نتيجته ولم يُجب عن المقياس البعدي: تعود الصفحة إلى النتيجة والمقياس
      questionsFinished: !!session.questionsFinishedAt,
      result: session.questionsFinishedAt ? await buildResult(exam, session, req.user._id) : null,
    },
  });
});

const submit = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { questionId, optionId, timeTakenSeconds } = req.body;

  const exam = await findOpenExam(code, req.user);
  if (!exam) throw new ApiError(404, CLOSED_MESSAGE);

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
      // تعليق الإجابة الصحيحة يُرسل الآن فقط، بعد أن أصاب الطالب
      correctExplanation: isCorrect ? option.correctExplanation || '' : '',
      feedback: isCorrect
        ? null
        : { type: feedbackType, label: FEEDBACK_TYPE_LABELS[feedbackType], content: option.feedback[feedbackType] || '' },
      serverTime: new Date().toISOString(),
    },
  });
});

// نتيجة الاختبار كما تُعرض للطالب: بعد الإنهاء، وعند عودته إلى المقياس البعدي
const buildResult = async (exam, session, userId) => {
  const questionCount = await Question.countDocuments({ exam: exam._id });

  let history = null;
  if (exam.showScoreHistory) {
    const pastSessions = (
      await Session.find({
        user: userId,
        $or: [{ status: 'completed' }, { _id: session._id }],
      }).populate({ path: 'exam', select: 'title attemptsPerQuestion' })
    ).sort((a, b) => {
      // المحاولة المعروضة الآن أولًا، ثم الأحدث فالأقدم
      const at = (x) => (String(x._id) === String(session._id) ? Infinity : +x.completedAt || 0);
      return at(b) - at(a);
    });
    const examIds = pastSessions.map((s) => s.exam?._id).filter(Boolean);
    const counts = await Question.aggregate([
      { $match: { exam: { $in: examIds } } },
      { $group: { _id: '$exam', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
    history = pastSessions.map((s) => {
      const qCount = countMap[String(s.exam?._id)] || 0;
      // عدد الأسئلة الخاطئة = أسئلة نفدت محاولاتها بلا إجابة صحيحة،
      // وليس عدد المحاولات الخاطئة (سؤال واحد قد يُخطئ فيه الطالب مرتين)
      const tries = s.exam?.attemptsPerQuestion || 1;
      const wrongQuestions = (s.details || []).filter(
        (d) => !d.isCorrect && d.attempts >= tries
      ).length;
      return {
        sessionId: s._id,
        examId: s.exam?._id,
        examTitle: s.exam?.title || 'اختبار محذوف',
        questionCount: qCount,
        correctCount: s.correctCount,
        wrongQuestions,
        wrongAttempts: s.wrongCount,
        skippedCount: s.skippedCount || 0,
        timeSeconds: s.totalTimeSeconds || 0,
        badges: s.badges || 0,
        completedAt: s.completedAt,
      };
    });
  }


  return {
    sessionId: session._id,
    examTitle: exam.title,
    showScoreHistory: exam.showScoreHistory,
    history,
    questionCount,
    correctCount: session.correctCount,
    wrongAttempts: session.wrongCount,
    skippedCount: session.skippedCount || 0,
    badges: session.badges,
    feedbackType: session.feedbackType,
    postSurveyDone: !!(await PostExamSurvey.exists({ session: session._id })),
    // تُسجَّل النتيجة بالمقياس البعدي، لا بعرضها
    recorded: session.status === 'completed',
  };
};

/*
 * تسليم الأسئلة وعرض النتيجة. لا تُسجَّل النتيجة هنا: تبقى الجلسة قيد التقدم
 * حتى يُجيب الطالب عن المقياس البعدي.
 */
const finish = asyncHandler(async (req, res) => {
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

  // مقياس الفائدة المدركة إلزامي قبل التسليم والنتيجة
  if (!(await UsefulnessSurvey.exists({ session: session._id }))) {
    throw new ApiError(400, 'أكمل مقياس الفائدة المدركة للتغذية الراجعة أولًا');
  }

  // أول تسليم فقط يحدد الزمن والأسئلة المتروكة؛ تكراره (إعادة تحميل) يعيد النتيجة نفسها
  if (!session.questionsFinishedAt) {
    // الأسئلة التي تجاوزت الوقت المسموح = ما لم يُحسم: لم يُجب صحيحًا ولم تنفد محاولاته
    const examQuestions = await Question.find({ exam: exam._id }).select('_id');
    const resolved = new Set(
      (session.details || [])
        .filter((d) => d.question && (d.isCorrect || d.attempts >= exam.attemptsPerQuestion))
        .map((d) => String(d.question))
    );
    session.set({
      questionsFinishedAt: new Date(),
      totalTimeSeconds: Math.max(Number(totalTimeSeconds) || 0, 0),
      skippedCount: examQuestions.filter((q) => !resolved.has(String(q._id))).length,
    });
    await session.save();
  }

  // جلسة بدأت بالترتيب القديم وأجاب فيها الطالب عن المقياس البعدي قبل التسليم:
  // لا يُطلب منه مرة أخرى، وتُسجَّل نتيجته الآن
  if (await PostExamSurvey.exists({ session: session._id })) {
    const recorded = await Session.updateOne(
      { _id: session._id, status: 'in-progress' },
      { $set: { status: 'completed', completedAt: new Date() } }
    );
    if (recorded.modifiedCount === 1) {
      await Exam.updateOne({ _id: exam._id }, { $inc: { completions: 1 } });
      session.status = 'completed';
    }
  }

  res.json({ success: true, data: await buildResult(exam, session, req.user._id) });
});

/*
 * يحفظ إجابات مقياس مرة واحدة لكل جلسة: كل العبارات مطلوبة، وكل إجابة
 * يجب أن تكون إحدى درجات الاختيارات.
 */
const saveScale = async ({ Model, definition, session, userId, examId, answers, missingMessage }) => {
  const existing = await Model.findOne({ session: session._id });
  if (existing) return { alreadySubmitted: true, result: existing.result };

  const { items, choices } = definition;
  if (!Array.isArray(answers) || answers.length !== items.length) {
    throw new ApiError(400, missingMessage);
  }

  const choiceByScore = new Map(choices.map((c) => [c.score, c]));
  const answerDocs = answers.map((raw, i) => {
    const score = Number(raw);
    const choice = Number.isInteger(score) ? choiceByScore.get(score) : null;
    if (!choice) throw new ApiError(400, `اختر إجابة صحيحة للبند ${i + 1}`);
    return { item: i, text: items[i], score, label: choice.label };
  });

  const totalScore = answerDocs.reduce((sum, a) => sum + a.score, 0);
  const itemCount = answerDocs.length;
  const result = Math.round((totalScore / itemCount) * 100) / 100;

  try {
    await Model.create({
      user: userId,
      exam: examId,
      session: session._id,
      answers: answerDocs,
      totalScore,
      itemCount,
      result,
      submittedAt: new Date(),
    });
  } catch (err) {
    // ضغطتان متتاليتان: الثانية تصطدم بقيد التفرّد على الجلسة
    if (err.code === 11000) return { alreadySubmitted: true };
    throw err;
  }
  return { created: true, totalScore, itemCount, result };
};

const sendScaleOutcome = (res, outcome) =>
  outcome.created
    ? res.status(201).json({
        success: true,
        data: { totalScore: outcome.totalScore, itemCount: outcome.itemCount, result: outcome.result },
      })
    : res.json({ success: true, data: { alreadySubmitted: true, result: outcome.result } });

// مقياس الفائدة المدركة: بعد آخر سؤال وقبل النتيجة، فالجلسة ما زالت قيد التقدم
const submitUsefulness = asyncHandler(async (req, res) => {
  const exam = await findOpenExam(req.params.code, req.user);
  if (!exam) throw new ApiError(404, CLOSED_MESSAGE);

  const session = await Session.findOne({
    user: req.user._id,
    exam: exam._id,
    status: 'in-progress',
  });
  if (!session) throw new ApiError(400, 'لا يوجد اختبار نشط');

  const outcome = await saveScale({
    Model: UsefulnessSurvey,
    definition: USEFULNESS_SURVEY,
    session,
    userId: req.user._id,
    examId: exam._id,
    answers: req.body.answers,
    missingMessage: 'أجب عن جميع بنود مقياس الفائدة المدركة',
  });
  sendScaleOutcome(res, outcome);
});

/*
 * المقياس البعدي: بعد عرض النتيجة، وبه تُسجَّل النتيجة. لا يُشترط أن يكون الاختبار
 * ما زال مفتوحًا، فقد يغلقه المسؤول بعد أن رأى الطالب نتيجته.
 */
const submitPostSurvey = asyncHandler(async (req, res) => {
  const exam = await Exam.findOne({ code: req.params.code });
  if (!exam) throw new ApiError(404, CLOSED_MESSAGE);

  const session = await Session.findOne({ user: req.user._id, exam: exam._id }).sort({
    startedAt: -1,
  });
  if (!session) throw new ApiError(400, 'لا يوجد اختبار لهذا المقياس');

  // ضغطة ثانية بعد أن سُجّلت النتيجة
  if (session.status === 'completed') {
    const existing = await PostExamSurvey.findOne({ session: session._id });
    if (existing) {
      return res.json({ success: true, data: { alreadySubmitted: true, result: existing.result } });
    }
  }
  if (!session.questionsFinishedAt) {
    throw new ApiError(400, 'أكمل الاختبار أولًا، ثم أجب عن المقياس البعدي بعد عرض نتيجتك');
  }

  const outcome = await saveScale({
    Model: PostExamSurvey,
    definition: POST_EXAM_SURVEY,
    session,
    userId: req.user._id,
    examId: exam._id,
    answers: req.body.answers,
    missingMessage: 'أجب عن جميع بنود المقياس البعدي',
  });

  // تسجيل النتيجة. شرط الحالة يمنع العدّ مرتين إن وصل طلبان معًا.
  const recorded = await Session.updateOne(
    { _id: session._id, status: 'in-progress' },
    { $set: { status: 'completed', completedAt: new Date() } }
  );
  if (recorded.modifiedCount === 1) {
    await Exam.updateOne({ _id: exam._id }, { $inc: { completions: 1 } });
  }

  sendScaleOutcome(res, outcome);
});

module.exports = { getMeta, start, submit, finish, submitUsefulness, submitPostSurvey };