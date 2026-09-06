const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { FEEDBACK_TYPE_LABELS } = require('../constants');
const User = require('../models/User');
const Group = require('../models/Group');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');
const FeedbackRating = require('../models/FeedbackRating');

const overview = asyncHandler(async (req, res) => {
  const [students, groups, exams, publishedExams, sessions, completedSessions, attempts] =
    await Promise.all([
      User.countDocuments({ role: 'student' }),
      Group.countDocuments({ isActive: true }),
      Exam.countDocuments(),
      Exam.countDocuments({ isPublished: true }),
      Session.countDocuments(),
      Session.countDocuments({ status: 'completed' }),
      Attempt.countDocuments(),
    ]);

  const correctAttempts = await Attempt.countDocuments({ isCorrect: true });

  const correctDetails = await Session.aggregate([
    { $unwind: '$details' },
    { $match: { 'details.correctAttempt': { $ne: null } } },
    {
      $group: {
        _id: null,
        avgAttempts: { $avg: '$details.correctAttempt' },
        avgTime: { $avg: '$details.totalTimeSeconds' },
        count: { $sum: 1 },
      },
    },
  ]);

  const badgesAgg = await Session.aggregate([
    { $group: { _id: null, totalBadges: { $sum: '$badges' } } },
  ]);

  const c = correctDetails[0] || {};

  res.json({
    success: true,
    data: {
      students,
      groups,
      exams,
      publishedExams,
      sessions,
      completedSessions,
      attempts,
      correctAttempts,
      correctRate: attempts ? correctAttempts / attempts : 0,
      avgAttemptsBeforeCorrect: Math.round((c.avgAttempts || 0) * 100) / 100,
      avgTimePerQuestion: Math.round((c.avgTime || 0) * 100) / 100,
      completedQuestions: c.count || 0,
      badges: badgesAgg[0]?.totalBadges || 0,
    },
  });
});

const byFeedback = asyncHandler(async (req, res) => {
  const rows = await Session.aggregate([
    { $match: { status: 'completed', feedbackType: { $ne: null } } },
    { $unwind: '$details' },
    {
      $group: {
        _id: '$feedbackType',
        questions: { $sum: 1 },
        correctQuestions: { $sum: { $cond: ['$details.isCorrect', 1, 0] } },
        attemptsSum: { $sum: '$details.attempts' },
        correctedAttempts: { $sum: { $cond: ['$details.correctAttempt', '$details.correctAttempt', 0] } },
        correctDetails: { $sum: { $cond: ['$details.correctAttempt', 1, 0] } },
        timeSum: { $sum: '$details.totalTimeSeconds' },
      },
    },
  ]);

  const data = rows.map((r) => ({
    feedbackType: r._id,
    label: FEEDBACK_TYPE_LABELS[r._id] || r._id,
    questions: r.questions,
    correctRate: r.questions ? r.correctQuestions / r.questions : 0,
    avgAttemptsBeforeCorrect: r.correctDetails ? r.correctedAttempts / r.correctDetails : 0,
    avgAttemptsPerQuestion: r.questions ? r.attemptsSum / r.questions : 0,
    avgTimePerQuestion: r.questions ? r.timeSum / r.questions : 0,
  }));

  res.json({ success: true, data });
});

const examsStats = asyncHandler(async (req, res) => {
  const rows = await Session.aggregate([
    { $match: { status: 'completed' } },
    {
      $group: {
        _id: '$exam',
        sessions: { $sum: 1 },
        correct: { $sum: '$correctCount' },
        stars: { $sum: '$stars' },
        wrongAttempts: { $sum: '$wrongCount' },
        timeSum: { $sum: '$totalTimeSeconds' },
      },
    },
    { $sort: { sessions: -1 } },
  ]);

  const exams = await Exam.find({ _id: { $in: rows.map((r) => r._id) } }).populate({
    path: 'topic',
    populate: { path: 'chapter' },
  });

  const data = rows.map((r) => {
    const exam = exams.find((e) => String(e._id) === String(r._id));
    return {
      examId: r._id,
      title: exam?.title || 'محذوف',
      topic: exam?.topic?.title || '—',
      chapter: exam?.topic?.chapter?.title || '—',
      sessions: r.sessions,
      totalQuestions: 0,
      avgCorrect: r.sessions ? r.correct / r.sessions : 0,
      avgStars: r.sessions ? r.stars / r.sessions : 0,
      avgWrongAttempts: r.sessions ? r.wrongAttempts / r.sessions : 0,
      avgTimeSeconds: r.sessions ? r.timeSum / r.sessions : 0,
    };
  });

  res.json({ success: true, data });
});

const studentsStats = asyncHandler(async (req, res) => {
  const rows = await Session.aggregate([
    { $match: { status: 'completed' } },
    {
      $group: {
        _id: '$user',
        sessions: { $sum: 1 },
        correct: { $sum: '$correctCount' },
        stars: { $sum: '$stars' },
        badges: { $sum: '$badges' },
        timeSum: { $sum: '$totalTimeSeconds' },
      },
    },
  ]);

  const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).populate('group');

  const data = rows
    .map((r) => {
      const u = users.find((x) => String(x._id) === String(r._id));
      return {
        userId: r._id,
        name: u?.name || 'محذوف',
        username: u?.username || '',
        group: u?.group?.name || null,
        feedbackType: u?.group?.feedbackType || null,
        sessions: r.sessions,
        correct: r.correct,
        stars: r.stars,
        badges: r.badges,
        avgTimeSeconds: r.sessions ? r.timeSum / r.sessions : 0,
      };
    })
    .sort((a, b) => b.stars - a.stars || b.sessions - a.sessions);

  res.json({ success: true, data });
});

const examDetail = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new ApiError(404, 'الاختبار غير موجود');

  const questions = await Question.find({ exam: exam._id }).sort({ order: 1 });

  const rows = await Attempt.aggregate([
    { $match: { exam: exam._id } },
    {
      $group: {
        _id: '$question',
        attempts: { $sum: 1 },
        correct: { $sum: { $cond: ['$isCorrect', 1, 0] } },
        timeSum: { $sum: '$timeTakenSeconds' },
        correctFirstTry: {
          $sum: {
            $cond: [{ $and: ['$isCorrect', { $eq: ['$attemptNumber', 1] }] }, 1, 0],
          },
        },
      },
    },
  ]);

  const data = questions.map((q) => {
    const r = rows.find((x) => String(x._id) === String(q._id)) || {
      attempts: 0,
      correct: 0,
      timeSum: 0,
      correctFirstTry: 0,
    };
    return {
      questionId: q._id,
      order: q.order,
      text: q.text,
      attempts: r.attempts,
      correctRate: r.attempts ? r.correct / r.attempts : 0,
      firstTryRate: r.attempts ? r.correctFirstTry / r.attempts : 0,
      avgTimeSeconds: r.attempts ? r.timeSum / r.attempts : 0,
    };
  });

  res.json({ success: true, data: { examTitle: exam.title, quiz: exam, questions: data } });
});

const perStudentExam = asyncHandler(async (req, res) => {
  const { student = '', group = '', exam = '', from = '', to = '' } = req.query;

  const match = { status: 'completed' };

  if (student) {
    const u = await User.findById(student);
    match.user = u ? u._id : null;
  }

  if (exam) {
    const e = await Exam.findById(exam);
    match.exam = e ? e._id : null;
  }

  if (group) {
    const members = await User.find({ group }).select('_id');
    match.user = { $in: members.map((m) => m._id) };
  }

  if (from || to) {
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setDate(end.getDate() + 1);
      range.$lt = end;
    }
    match.completedAt = range;
  }

  const [sessions, students, groups, exams, questionCounts] = await Promise.all([
    Session.find(match)
      .populate({ path: 'user', populate: { path: 'group' } })
      .populate({ path: 'exam', populate: { path: 'topic', populate: { path: 'chapter' } } })
      .sort({ completedAt: -1 }),
    User.find({ role: 'student' }).sort({ name: 1 }).select('name username'),
    Group.find().sort({ name: 1 }).select('name'),
    Exam.find().sort({ title: 1 }).select('title'),
    Question.aggregate([{ $group: { _id: '$exam', count: { $sum: 1 } } }]),
  ]);

  const questionCountByExam = {};
  questionCounts.forEach((q) => {
    questionCountByExam[String(q._id)] = q.count;
  });

  const data = sessions
    .map((s) => {
      const correctDetails = s.details.filter((d) => d.correctAttempt != null);
      const avgTries = correctDetails.length
        ? correctDetails.reduce((sum, d) => sum + d.correctAttempt, 0) / correctDetails.length
        : 0;
      const correctTime = correctDetails.reduce((sum, d) => sum + (d.totalTimeSeconds || 0), 0);
      const avgTimePerQuestion = correctDetails.length ? correctTime / correctDetails.length : 0;

      const totalQuestions = questionCountByExam[String(s.exam?._id)] || s.details.length || 0;
      const totalTries = (s.details || []).reduce((sum, d) => sum + (d.attempts || 0), 0);

      return {
        sessionId: s._id,
        studentId: s.user?._id,
        studentName: s.user?.name || 'محذوف',
        username: s.user?.username || '',
        group: s.user?.group?.name || null,
        examId: s.exam?._id,
        examTitle: s.exam?.title || 'محذوف',
        chapter: s.exam?.topic?.chapter?.title || '—',
        topic: s.exam?.topic?.title || '—',
        correctCount: s.correctCount,
        wrongAttempts: s.wrongCount,
        skipped: s.skippedCount,
        totalQuestions,
        totalTries,
        stars: s.stars,
        badges: s.badges || 0,
        avgTriesBeforeCorrect: Math.round(avgTries * 100) / 100,
        avgTimePerQuestion: Math.round(avgTimePerQuestion * 100) / 100,
        completedAt: s.completedAt,
      };
    })
    .filter((r) => (student ? r.studentId && String(r.studentId) === student : true))
    .filter((r) => (exam ? r.examId && String(r.examId) === exam : true));

  res.json({
    success: true,
    data,
    students: students.map((s) => ({ _id: s._id, name: s.name, username: s.username })),
    groups: groups.map((g) => ({ _id: g._id, name: g.name })),
    exams: exams.map((e) => ({ _id: e._id, title: e.title })),
  });
});

const feedbackRatings = asyncHandler(async (req, res) => {
  const { exam = '', student = '', group = '' } = req.query;

  const match = {};
  if (exam) match.exam = exam;
  if (student) match.user = student;

  if (!exam && !student && !group) {
    return res.json({
      success: true,
      data: {
        questions: [],
        students: [],
        avgPerQuestion: [],
        overallAvg: 0,
      },
    });
  }

  if (group) {
    const members = await User.find({ group }).select('_id');
    match.user = { $in: members.map((m) => m._id) };
  }

  const exams = exam
    ? await Exam.find({ _id: match.exam }).select('title')
    : await Exam.find({ _id: { $in: (await FeedbackRating.distinct('exam', match)) } }).select('title');

  const ratings = await FeedbackRating.find(match)
    .populate({ path: 'user', populate: { path: 'group' } })
    .populate({ path: 'question', select: 'text order' })
    .sort({ createdAt: 1 });

  const questionOrderMap = {};
  const examQuestionCount = {};

  const examIds = exams.map((e) => e._id);
  if (examIds.length > 0) {
    const questionsAll = await Question.find({ exam: { $in: examIds } }).sort({ order: 1 }).select('text order exam');
    questionsAll.forEach((q) => {
      const key = String(q.exam);
      if (!questionOrderMap[key]) questionOrderMap[key] = [];
      questionOrderMap[key].push({ questionId: q._id, order: q.order, text: q.text });
    });
    questionsAll.forEach((q) => {
      examQuestionCount[String(q.exam)] = (examQuestionCount[String(q.exam)] || 0) + 1;
    });
  }

  const byKey = {};
  for (const r of ratings) {
    const studentId = String(r.user?._id);
    const examId = String(r.exam);
    const key = `${studentId}|${examId}`;
    if (!byKey[key]) {
      const examTitle = exams.find((e) => String(e._id) === examId)?.title || '';
      byKey[key] = {
        studentId,
        studentName: r.user?.name || 'بدون اسم',
        group: r.user?.group?.name || null,
        examId,
        examTitle,
        perQuestion: {},
      };
    }
    const score = Math.round((r.score || 0) * 100) / 100;
    byKey[key].perQuestion[String(r.question?._id)] = { order: r.question?.order, score };
  }

  const students = Object.values(byKey).map((s) => {
    const ordered = (questionOrderMap[s.examId] || [])
      .map((q) => ({
        questionId: q.questionId,
        order: q.order,
        text: q.text,
        score: s.perQuestion[String(q.questionId)]?.score ?? null,
      }))
      .sort((a, b) => a.order - b.order);
    const totalQuestionCount = examQuestionCount[s.examId] || ordered.filter((x) => x.score != null).length;
    const sum = ordered.reduce((acc, x) => acc + (x.score != null ? x.score : 0), 0);
    const total = totalQuestionCount
      ? Math.round((sum / totalQuestionCount) * 100) / 100
      : 0;
    return {
      studentId: s.studentId,
      studentName: s.studentName,
      group: s.group,
      examId: s.examId,
      examTitle: s.examTitle,
      perQuestion: ordered,
      total,
    };
  });

  const questionsUnion = {};
  students.forEach((s) =>
    s.perQuestion.forEach((q) => {
      if (q.score != null && !questionsUnion[q.questionId]) {
        questionsUnion[q.questionId] = { questionId: q.questionId, order: q.order, text: q.text };
      }
    })
  );
  const questions = Object.values(questionsUnion).sort((a, b) => a.order - b.order);

  const avgPerQuestion = questions.map((q) => {
    const scores = students.flatMap((s) =>
      s.perQuestion.filter((x) => x.questionId === q.questionId && x.score != null).map((x) => x.score)
    );
    const avg = scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : 0;
    return { questionId: q.questionId, order: q.order, text: q.text, avg, count: scores.length };
  });

  const totals = students.filter((s) => s.total > 0).map((s) => s.total);
  const overallAvg = totals.length
    ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100
    : 0;

  res.json({
    success: true,
    data: {
      questions,
      students,
      avgPerQuestion,
      overallAvg,
    },
  });
});

module.exports = { overview, byFeedback, examsStats, studentsStats, examDetail, perStudentExam, feedbackRatings };