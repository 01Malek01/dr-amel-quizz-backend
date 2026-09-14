/*
 * بيانات محاكاة لجدول نتائج الطلاب في اختبار تغذية راجعة.
 *
 *   node src/scripts/simulateResults.js          إنشاء البيانات (يستبدل أي محاكاة سابقة)
 *   node src/scripts/simulateResults.js --clean  حذف بيانات المحاكاة فقط
 *
 * ينشئ موديولًا وموضوعًا واختبارًا من 8 أسئلة ومجموعتين و6 طلاب وجلسات مكتملة
 * تغطي كل مستويات الكأس (ذهبي/فضي/برونزي/بدون) وأعدادًا مختلفة من الشارات.
 * كل ما يُنشأ مُعلَّم بأسماء «محاكاة» وأسماء مستخدمين تبدأ بـ sim_ حتى يسهل حذفه،
 * ولا يلمس السكربت أي طالب أو اختبار حقيقي.
 */
require('dotenv').config();

const mongoose = require('mongoose');

const Chapter = require('../models/Chapter');
const Topic = require('../models/Topic');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Group = require('../models/Group');
const User = require('../models/User');
const Session = require('../models/Session');
const Attempt = require('../models/Attempt');
const FeedbackRating = require('../models/FeedbackRating');
const Survey = require('../models/Survey');
const SurveyQuestion = require('../models/SurveyQuestion');
const SurveyResponse = require('../models/SurveyResponse');
const { PREBUILT_SURVEY } = require('../constants');

const SIM_CHAPTER = 'محاكاة — بيانات تجريبية';
const SIM_TOPIC = 'محاكاة نتائج التغذية الراجعة';
const SIM_EXAM_CODE = 'SIM00001';
const SIM_SURVEY_CODE = 'SIMSURV1';
const SIM_USER_PREFIX = 'sim_';
const ATTEMPTS_PER_Q = 3;
const Q_COUNT = 8;

const QUESTIONS = [
  'ما الهدف الأساسي من التقويم التكويني أثناء عملية التعلم؟',
  'أي الأدوات التالية يُعد الأنسب لقياس مهارة أداء عملي؟',
  'ما المقصود بثبات الاختبار في القياس التربوي؟',
  'ما الفرق الجوهري بين القياس والتقويم؟',
  'أي العبارات التالية تصف صدق المحتوى بدقة؟',
  'متى يكون استخدام أسئلة الاختيار من متعدد أكثر ملاءمة؟',
  'ما أثر التغذية الراجعة الفورية على تحصيل الطالب؟',
  'كيف نضبط المتغيرات الدخيلة في تجربة تربوية؟',
];

const OPTIONS = [
  { text: 'الإجابة الصحيحة المتوقعة في هذا البند', isCorrect: true },
  { text: 'بديل قريب من الصواب لكنه ناقص', isCorrect: false },
  { text: 'بديل يحتوي مفهومًا مغلوطًا شائعًا', isCorrect: false },
  { text: 'بديل لا يتصل بالسؤال اتصالًا مباشرًا', isCorrect: false },
];

const GROUPS = [
  { name: 'محاكاة — مجموعة التلميح', feedbackType: 'hint', color: '#2563eb' },
  { name: 'محاكاة — مجموعة الموضوع', feedbackType: 'explanation', color: '#7c3aed' },
];

// correct = عدد الإجابات الصحيحة، firstTry = ما صحّ منها من المحاولة الأولى
const PLAN = [
  { name: 'نورة سعد القحطاني', u: 'noura', correct: 8, firstTry: 7, group: 0, rating: [5, 5, 4], mood: 5 },
  { name: 'عبدالله محمد العتيبي', u: 'abdullah', correct: 7, firstTry: 4, group: 0, rating: [4, 4, 4], mood: 4 },
  { name: 'ريم فيصل الدوسري', u: 'reem', correct: 6, firstTry: 3, group: 1, rating: [4, 3, 4], mood: 4 },
  { name: 'فهد ناصر الشمري', u: 'fahad', correct: 5, firstTry: 2, group: 1, rating: [3, 3, 3], mood: 3 },
  { name: 'لمى خالد الحربي', u: 'lama', correct: 4, firstTry: 1, group: 0, rating: [3, 2, 3], mood: 3 },
  { name: 'ماجد سعود الزهراني', u: 'majed', correct: 2, firstTry: 0, group: 1, rating: [2, 2, 1], mood: 2 },
];

const pctOf = (c, t) => (t ? Math.round((c / t) * 100) : 0);
const tierOf = (p) => (p >= 85 ? 'ذهبي' : p >= 75 ? 'فضي' : p >= 60 ? 'برونزي' : 'بدون كأس');

const clean = async () => {
  const survey = await Survey.findOne({ code: SIM_SURVEY_CODE });
  if (survey) {
    await SurveyResponse.deleteMany({ survey: survey._id });
    await SurveyQuestion.deleteMany({ survey: survey._id });
    await survey.deleteOne();
  }

  const exam = await Exam.findOne({ code: SIM_EXAM_CODE });
  if (exam) {
    await Session.deleteMany({ exam: exam._id });
    await Attempt.deleteMany({ exam: exam._id });
    await FeedbackRating.deleteMany({ exam: exam._id });
    await Question.deleteMany({ exam: exam._id });
    await exam.deleteOne();
  }

  const users = await User.find({ username: { $regex: `^${SIM_USER_PREFIX}` } }).select('_id');
  if (users.length) {
    const ids = users.map((u) => u._id);
    await Session.deleteMany({ user: { $in: ids } });
    await Attempt.deleteMany({ user: { $in: ids } });
    await FeedbackRating.deleteMany({ user: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
  }

  const chapter = await Chapter.findOne({ title: SIM_CHAPTER });
  if (chapter) {
    await Topic.deleteMany({ chapter: chapter._id });
    await chapter.deleteOne();
  }

  await Group.deleteMany({ name: { $in: GROUPS.map((g) => g.name) } });

  return { exam: !!exam, students: users.length };
};

const seed = async () => {
  const chapter = await Chapter.create({ title: SIM_CHAPTER });
  const topic = await Topic.create({ title: SIM_TOPIC, chapter: chapter._id });

  const exam = await Exam.create({
    title: 'اختبار محاكاة النتائج (8 أسئلة)',
    description: 'بيانات تجريبية لعرض جدول نتائج الطلاب — يمكن حذفها في أي وقت.',
    topic: topic._id,
    code: SIM_EXAM_CODE,
    isPublished: true,
    attemptsPerQuestion: ATTEMPTS_PER_Q,
    questionTimeSeconds: 90,
    feedbackType: 'hint',
    showScoreHistory: true,
    completions: PLAN.length,
  });

  const questions = [];
  for (let i = 0; i < Q_COUNT; i++) {
    questions.push(
      await Question.create({
        exam: exam._id,
        order: i,
        text: QUESTIONS[i],
        options: OPTIONS.map((o) => ({
          text: o.text,
          isCorrect: o.isCorrect,
          correctExplanation: o.isCorrect
            ? 'هذه هي الإجابة الصحيحة لارتباطها المباشر بمفهوم السؤال.'
            : '',
          feedback: o.isCorrect
            ? {}
            : {
                hint: 'راجع تعريف المفهوم في السؤال ثم أعد المحاولة.',
                roadmap: 'الاستجابة المتوقعة هي الخيار الذي يعرّف المفهوم تعريفًا مباشرًا.',
                explanation: 'موضوع السؤال هو التمييز بين المفهوم وما يشبهه من مفاهيم قريبة.',
                custom: 'انتبه إلى الكلمات المفتاحية في نص السؤال.',
              },
        })),
      })
    );
  }

  const groups = [];
  for (const g of GROUPS) groups.push(await Group.create({ ...g, isActive: true }));

  // رابط مقياس الانفعالات المرتبط بهذا الاختبار
  const survey = await Survey.create({
    title: `${PREBUILT_SURVEY.title} (محاكاة)`,
    intro: PREBUILT_SURVEY.intro,
    exam: exam._id,
    code: SIM_SURVEY_CODE,
    isActive: true,
    isPredefined: true,
    choices: PREBUILT_SURVEY.choices.map((c) => ({ label: c.label, score: c.score })),
  });

  const surveyItems = [];
  for (const [i, text] of PREBUILT_SURVEY.items.entries()) {
    surveyItems.push(await SurveyQuestion.create({ survey: survey._id, order: i, text }));
  }
  const choiceByScore = new Map(survey.choices.map((c) => [c.score, c]));
  const pickChoice = (score) => choiceByScore.get(Math.min(5, Math.max(1, score)));

  const summary = [];
  let dayOffset = PLAN.length;

  for (const p of PLAN) {
    const user = await User.create({
      name: p.name,
      username: SIM_USER_PREFIX + p.u,
      email: `${SIM_USER_PREFIX}${p.u}@sim.test`,
      password: 'sim12345',
      role: 'student',
      group: groups[p.group]._id,
    });

    const feedbackType = groups[p.group].feedbackType;
    const completedAt = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
    dayOffset -= 1;

    const session = await Session.create({
      user: user._id,
      exam: exam._id,
      status: 'completed',
      feedbackType,
      startedAt: completedAt,
      completedAt,
      details: [],
    });

    let correctLeft = p.correct;
    let firstTryLeft = p.firstTry;
    let wrongAttempts = 0;
    let badges = 0;
    let totalTime = 0;
    const details = [];

    for (let i = 0; i < Q_COUNT; i++) {
      const q = questions[i];
      const correctOpt = q.options.find((o) => o.isCorrect);
      const wrongOpts = q.options.filter((o) => !o.isCorrect);

      const willBeCorrect = correctLeft > 0;
      const onFirstTry = willBeCorrect && firstTryLeft > 0;
      const attemptsUsed = willBeCorrect ? (onFirstTry ? 1 : 2) : ATTEMPTS_PER_Q;
      const seconds = 20 + ((i * 7 + p.correct * 3) % 40);

      for (let a = 1; a <= attemptsUsed; a++) {
        const isCorrectAttempt = willBeCorrect && a === attemptsUsed;
        if (!isCorrectAttempt) wrongAttempts += 1;
        await Attempt.create({
          user: user._id,
          session: session._id,
          exam: exam._id,
          question: q._id,
          optionId: isCorrectAttempt ? correctOpt._id : wrongOpts[(a - 1) % wrongOpts.length]._id,
          isCorrect: isCorrectAttempt,
          attemptNumber: a,
          timeTakenSeconds: Math.round(seconds / attemptsUsed),
          feedbackType,
          feedbackShown: !isCorrectAttempt,
        });
      }

      if (willBeCorrect) {
        correctLeft -= 1;
        if (onFirstTry) {
          firstTryLeft -= 1;
          badges += 1;
        }
      }

      totalTime += seconds;
      details.push({
        question: q._id,
        attempts: attemptsUsed,
        isCorrect: willBeCorrect,
        correctAttempt: willBeCorrect ? attemptsUsed : null,
        firstTryCorrect: onFirstTry,
        totalTimeSeconds: seconds,
      });

      const jitter = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : -1;
      const items = p.rating.map((v) => Math.min(5, Math.max(1, v + (i === 0 ? 0 : jitter))));
      await FeedbackRating.create({
        user: user._id,
        exam: exam._id,
        session: session._id,
        question: q._id,
        item1: items[0],
        item2: items[1],
        item3: items[2],
        score: Math.round(((items[0] + items[1] + items[2]) / 3) * 100) / 100,
      });

    }

    session.set({
      correctCount: p.correct,
      wrongCount: wrongAttempts,
      skippedCount: Math.max(Q_COUNT - (p.correct + wrongAttempts), 0),
      badges,
      totalTimeSeconds: totalTime,
      details,
    });
    await session.save();

    // إجابات بعض الطلاب على رابط المقياس
    if (['noura', 'fahad', 'majed'].includes(p.u)) {
      const standaloneAnswers = surveyItems.map((item, idx) => {
        const choice = pickChoice(p.mood + (idx % 2 === 0 ? 0 : -1));
        return { question: item._id, choiceLabel: choice.label, score: choice.score };
      });
      const total = standaloneAnswers.reduce((sum, a) => sum + a.score, 0);
      await SurveyResponse.create({
        survey: survey._id,
        user: user._id,
        source: 'standalone',
        answers: standaloneAnswers,
        totalScore: total,
        questionCount: standaloneAnswers.length,
        result: Math.round((total / standaloneAnswers.length) * 100) / 100,
        submittedAt: completedAt,
      });
    }

    const pct = pctOf(p.correct, Q_COUNT);
    summary.push(
      `${p.name}  ${p.correct}/${Q_COUNT} = ${pct}%  ·  كأس: ${tierOf(pct)}  ·  شارات: ${badges}`
    );
  }

  return { exam, survey, summary };
};

(async () => {
  const wantsClean = process.argv.includes('--clean');

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`قاعدة البيانات: ${mongoose.connection.name}`);

  const removed = await clean();
  if (wantsClean) {
    console.log(
      `تم حذف بيانات المحاكاة${removed.exam ? ' (الاختبار)' : ''}` +
        (removed.students ? ` و${removed.students} طالبًا` : '')
    );
    await mongoose.disconnect();
    return;
  }

  const { exam, survey, summary } = await seed();
  console.log(`\n${exam.title} — الرمز ${exam.code}`);
  summary.forEach((line) => console.log('  ' + line));
  const viaLink = await SurveyResponse.countDocuments({ survey: survey._id, source: 'standalone' });
  console.log(`\nالمقياس المرتبط: ${survey.title} — الرمز ${survey.code}`);
  console.log(`  إجابات على الرابط: ${viaLink}`);
  console.log('\nأين تُعرض:');
  console.log('  الدرجات والكؤوس والشارات: الإحصائيات ← اختر اختبار المحاكاة');
  console.log('  المقياس عبر الرابط: المقاييس القبلية ← إدارة ← تبويب النتائج');
  console.log('\nللحذف: node src/scripts/simulateResults.js --clean');

  await mongoose.disconnect();
})().catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
