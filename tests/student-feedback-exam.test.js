const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, makeFeedbackExam, MISSING_ID } = require('./helpers');
const mongoose = require('mongoose');
const { POST_EXAM_SURVEY, PREBUILT_SURVEY, USEFULNESS_SURVEY } = require('../src/constants');
const PostExamSurveyModel = require('../src/models/PostExamSurvey');

// المقياس البعدي: عدد عباراته يأتي من الثابت لا من رقم مكتوب في الاختبار
const POST_N = POST_EXAM_SURVEY.items.length;
const postAnswers = (value) => Array(POST_N).fill(value);
const PATTERN = Array.from({ length: POST_N }, (_, i) => [5, 4, 4, 3, 2, 1, 2, 3][i % 8]);
const PATTERN_TOTAL = PATTERN.reduce((a, b) => a + b, 0);
const PATTERN_RESULT = Math.round((PATTERN_TOTAL / POST_N) * 100) / 100;
const Session = require('../src/models/Session');

// مقياس الفائدة المدركة: بعد آخر سؤال وقبل النتيجة
const U_N = USEFULNESS_SURVEY.items.length;
const usefulnessAnswers = (value) => Array(U_N).fill(value);

let request;
let users;
let fixture;

const correctOptionOf = (q) => q.options.find((o) => o.isCorrect);
const wrongOptionOf = (q) => q.options.find((o) => !o.isCorrect);

// نهاية الاختبار بالترتيب الجديد: مقياس الفائدة ← الإنهاء (النتيجة) ← المقياس البعدي
const answerUsefulness = (code, value = 4) =>
  request(`/exam/${code}/usefulness-survey`, {
    method: 'POST',
    token: users.studentToken,
    body: { answers: usefulnessAnswers(value) },
  });
// يسلّم الأسئلة ويعرض النتيجة دون تسجيلها
const finishExam = (code, seconds = 30) =>
  request(`/exam/${code}/finish`, {
    method: 'POST',
    token: users.studentToken,
    body: { totalTimeSeconds: seconds },
  });
// المقياس البعدي: به تُسجَّل النتيجة. لا قيمة افتراضية للإجابات عن قصد،
// حتى يصل undefined كما هو في اختبارات الرفض.
const answerPost = (code, answers) =>
  request(`/exam/${code}/post-survey`, {
    method: 'POST',
    token: users.studentToken,
    body: { answers },
  });

before(async () => {
  request = client(await boot('dq_test_student_exam'));
  users = await makeUsers({ groupFeedbackType: 'explanation' });
  fixture = await makeFeedbackExam({ questionCount: 3, attemptsPerQuestion: 2 });
});

after(shutdown);

describe('بيانات الاختبار العامة', () => {
  test('رمز غير موجود يعيد 404 برسالة عربية', async () => {
    const res = await request('/exam/NOPE1234');
    assert.equal(res.status, 404);
    assert.match(res.body.message, /الاختبار غير متاح/);
  });

  test('الاختبار المنشور يعيد بياناته بدون تسجيل دخول', async () => {
    const res = await request('/exam/TESTEX1');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.questionCount, 3);
    assert.equal(res.body.data.attemptsPerQuestion, 2);
  });

  test('لا يكشف الإجابات الصحيحة في بيانات الاختبار العامة', async () => {
    const res = await request('/exam/TESTEX1');
    assert.equal(JSON.stringify(res.body).includes('isCorrect'), false);
  });
});

describe('بدء الاختبار', () => {
  test('البدء بدون تسجيل دخول يرفض', async () => {
    assert.equal((await request('/exam/TESTEX1/start', { method: 'POST' })).status, 401);
  });

  test('البدء يعيد الأسئلة والجلسة', async () => {
    const res = await request('/exam/TESTEX1/start', {
      method: 'POST',
      token: users.studentToken,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.sessionId);
    assert.equal(res.body.data.questions.length, 3);
  });

  test('البدء مرتين يعيد نفس الجلسة لا جلسة جديدة', async () => {
    const a = await request('/exam/TESTEX1/start', { method: 'POST', token: users.studentToken });
    const b = await request('/exam/TESTEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(String(a.body.data.sessionId), String(b.body.data.sessionId));
    const count = await Session.countDocuments({ user: users.student._id, exam: fixture.exam._id });
    assert.equal(count, 1);
  });
});

describe('الإجابة على الأسئلة', () => {
  test('إجابة خاطئة تعيد التغذية الرجعية بنمط المجموعة', async () => {
    const q = fixture.questions[0];
    const res = await request('/exam/TESTEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: wrongOptionOf(q)._id, timeTakenSeconds: 5 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isCorrect, false);
    // نمط المجموعة (explanation) يتقدّم على نمط الاختبار (hint)
    assert.equal(res.body.data.feedback.type, 'explanation');
    assert.equal(res.body.data.feedback.content, 'شرح الموضوع');
    assert.equal(res.body.data.attemptsLeft, 1);
    assert.equal(res.body.data.exhausted, false);
  });

  test('المحاولة الثانية الخاطئة تُنفد المحاولات', async () => {
    const q = fixture.questions[0];
    const res = await request('/exam/TESTEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: wrongOptionOf(q)._id, timeTakenSeconds: 5 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.attemptsLeft, 0);
    assert.equal(res.body.data.exhausted, true);
  });

  test('محاولة إضافية بعد النفاد ترفض بـ400 لا 500', async () => {
    const q = fixture.questions[0];
    const res = await request('/exam/TESTEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: wrongOptionOf(q)._id },
    });
    assert.equal(res.status, 400);
  });

  test('إجابة صحيحة من المحاولة الأولى تمنح الشارة', async () => {
    const q = fixture.questions[1];
    const res = await request('/exam/TESTEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: correctOptionOf(q)._id, timeTakenSeconds: 4 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isCorrect, true);
    assert.equal(res.body.data.badgeEarned, true);
    assert.equal(res.body.data.feedback, null);
    assert.equal(res.body.data.starsGained, undefined, 'لا يوجد نظام نجوم');
  });

  test('إعادة الإجابة على سؤال محسوم صحيحًا ترفض', async () => {
    const q = fixture.questions[1];
    const res = await request('/exam/TESTEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: correctOptionOf(q)._id },
    });
    assert.equal(res.status, 400);
  });

  test('معرّفات ناقصة أو غير صالحة لا تُسبب 500', async () => {
    const q = fixture.questions[2];
    const bodies = [
      {},
      { questionId: q._id },
      { questionId: MISSING_ID, optionId: MISSING_ID },
      { questionId: 'bad', optionId: 'bad' },
      { questionId: q._id, optionId: MISSING_ID },
      { questionId: q._id, optionId: correctOptionOf(q)._id, timeTakenSeconds: -50 },
      { questionId: q._id, optionId: correctOptionOf(q)._id, timeTakenSeconds: 'abc' },
    ];
    for (const body of bodies) {
      const res = await request('/exam/TESTEX1/submit', {
        method: 'POST',
        token: users.studentToken,
        body,
      });
      assert.ok(res.status < 500, `${JSON.stringify(body)} -> ${res.status} ${res.body.message}`);
    }
  });
});

describe('إنهاء الاختبار', () => {
  test('الإنهاء يُرفض قبل مقياس الفائدة المدركة', async () => {
    const res = await finishExam('TESTEX1', 60);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /مقياس الفائدة/);
  });

  test('المقياس البعدي لا يُقبل قبل الإنهاء: مكانه بعد النتيجة', async () => {
    const res = await answerPost('TESTEX1', PATTERN);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /أكمل الاختبار أولًا/);
  });

  test('بعد مقياس الفائدة المدركة يُسلَّم الاختبار وتظهر النتيجة دون تسجيلها', async () => {
    const useful = await answerUsefulness('TESTEX1', 4);
    assert.equal(useful.status, 201, useful.body.message);
    assert.equal(useful.body.data.itemCount, U_N);

    const res = await finishExam('TESTEX1', 120);
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.questionCount, 3);
    assert.equal(res.body.data.badges, 2);
    assert.equal(res.body.data.stars, undefined, 'لا يوجد نظام نجوم');
    assert.equal(res.body.data.postSurveyDone, false, 'المقياس البعدي ما زال مطلوبًا بعد النتيجة');
    assert.equal(res.body.data.recorded, false);

    const exam = await request(`/exams/${fixture.exam._id}`, { token: users.adminToken });
    assert.equal(exam.body.data.completedCount, 0, 'لا يُعدّ ضمن من أنهوا قبل المقياس البعدي');
    assert.equal(exam.body.data.inProgressCount, 1);
  });

  test('العودة بعد النتيجة وقبل المقياس البعدي: يُعاد إلى المقياس لا إلى الأسئلة', async () => {
    const res = await request('/exam/TESTEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.questionsFinished, true);
    assert.deepEqual(res.body.data.postSurvey.items, POST_EXAM_SURVEY.items);
    assert.equal(res.body.data.result.questionCount, 3);
    assert.equal(res.body.data.result.recorded, false);
  });

  test('إعادة التسليم بعد إعادة التحميل تعيد النتيجة نفسها ولا تغيّر الزمن', async () => {
    const again = await finishExam('TESTEX1', 999);
    assert.equal(again.status, 200, again.body.message);
    const session = await Session.findOne({ exam: fixture.exam._id });
    assert.equal(session.totalTimeSeconds, 120, 'الزمن من أول تسليم');
  });

  test('المقياس البعدي بعد النتيجة يُقبل، وبه تُسجَّل النتيجة', async () => {
    const post = await answerPost('TESTEX1', PATTERN);
    assert.equal(post.status, 201, post.body.message);
    assert.equal(post.body.data.totalScore, PATTERN_TOTAL);
    assert.equal(post.body.data.result, PATTERN_RESULT);

    const exam = await request(`/exams/${fixture.exam._id}`, { token: users.adminToken });
    assert.equal(exam.body.data.completedCount, 1, 'بالمقياس البعدي سُجّلت النتيجة');
    assert.equal(exam.body.data.inProgressCount, 0);
  });

  test('بعد المقياس البعدي: إعادة الاختبار ممنوعة (409)', async () => {
    const res = await request('/exam/TESTEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(res.status, 409);
  });

  test('الإنهاء مرتين يرفض بـ400', async () => {
    const res = await finishExam('TESTEX1', 10);
    assert.equal(res.status, 400);
  });

  test('الإجابة بعد الإنهاء ترفض بـ400 لا 500', async () => {
    const q = fixture.questions[2];
    const res = await request('/exam/TESTEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: correctOptionOf(q)._id },
    });
    assert.equal(res.status, 400);
  });
});

describe('مقياس الفائدة المدركة', () => {
  let usefulExam;

  test('التقييم الثلاثي بعد كل سؤال أُزيل: مساره لم يعد موجودًا', async () => {
    const q = fixture.questions[0];
    const res = await request('/feedback-rating/TESTEX1', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, item1: 4, item2: 4, item3: 4 },
    });
    assert.equal(res.status, 404);
  });

  test('ستة عشر بندًا بالاختيارات الخمسة كما في الملف', () => {
    assert.equal(U_N, 16);
    assert.deepEqual(USEFULNESS_SURVEY.choices.map((c) => c.score), [5, 4, 3, 2, 1]);
    assert.equal(new Set(USEFULNESS_SURVEY.items).size, U_N, 'لا بند مكرر');
  });

  test('إجابات ناقصة أو خارج المدى ترفض بـ400', async () => {
    usefulExam = await makeFeedbackExam({ questionCount: 1, code: 'USEFUL1' });
    await request('/exam/USEFUL1/start', { method: 'POST', token: users.studentToken });
    for (const answers of [
      undefined,
      [],
      usefulnessAnswers(5).slice(1),
      [...usefulnessAnswers(5), 5],
      [...usefulnessAnswers(5).slice(1), 9],
      [...usefulnessAnswers(5).slice(1), 0],
      [...usefulnessAnswers(5).slice(1), 2.5],
      [...usefulnessAnswers(5).slice(1), 'x'],
      'nope',
    ]) {
      const res = await request('/exam/USEFUL1/usefulness-survey', {
        method: 'POST',
        token: users.studentToken,
        body: { answers },
      });
      assert.equal(res.status, 400, `${JSON.stringify(answers)} -> ${res.status}`);
    }
  });

  test('يُحفظ مرة واحدة فقط', async () => {
    const first = await answerUsefulness('USEFUL1', 5);
    assert.equal(first.status, 201, first.body.message);
    const again = await answerUsefulness('USEFUL1', 1);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.alreadySubmitted, true);
  });

  test('نتائجه للمسؤول: صف لكل طالب وعمود لكل بند', async () => {
    const res = await request(`/stats/usefulness-survey?exam=${usefulExam.exam._id}`, {
      token: users.adminToken,
    });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.items.length, U_N);
    assert.equal(res.body.data.responseCount, 1);
    assert.deepEqual(res.body.data.students[0].scores, usefulnessAnswers(5));
    assert.equal(res.body.data.overallAvg, 5);
  });

  test('نتائجه محمية عن الطلاب', async () => {
    const res = await request(`/stats/usefulness-survey?exam=${usefulExam.exam._id}`, {
      token: users.studentToken,
    });
    assert.equal(res.status, 403);
  });
});

describe('لا يوجد مقياس الانفعالات بين الأسئلة', () => {
  test('بيانات الاختبار لا تحمل مقياسًا حتى لو كان له رابط مقياس', async () => {
    const other = await makeFeedbackExam({ questionCount: 1, code: 'NOSURV1' });
    const created = await request('/surveys', {
      method: 'POST',
      token: users.adminToken,
      body: { exam: String(other.exam._id) },
    });
    assert.equal(created.status, 201, created.body.message);

    const meta = await request('/exam/NOSURV1');
    assert.equal(meta.status, 200);
    assert.equal(meta.body.data.survey, undefined);
  });

  test('مسار تسليم المقياس داخل الاختبار غير موجود', async () => {
    const res = await request('/exam/TESTEX1/survey-submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionOrder: 0, answers: [] },
    });
    assert.equal(res.status, 404);
  });
});

describe('المقياس البعدي', () => {
  test('بدء الاختبار يرسل المقياسين، ولا أثر للتقييم بعد كل سؤال', async () => {
    await makeFeedbackExam({ questionCount: 2, attemptsPerQuestion: 2, code: 'POSTEX1' });
    const res = await request('/exam/POSTEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(res.status, 200, res.body.message);
    assert.deepEqual(res.body.data.postSurvey.items, POST_EXAM_SURVEY.items);
    assert.equal(res.body.data.postSurvey.choices.length, 5);
    assert.equal(res.body.data.postSurveyDone, false);
    assert.deepEqual(res.body.data.usefulnessSurvey.items, USEFULNESS_SURVEY.items);
    assert.equal(res.body.data.usefulnessDone, false);
    assert.equal(res.body.data.ratedQuestions, undefined);
    assert.equal(res.body.data.progress[0].rated, undefined);
  });

  test('سؤال تجاوز الوقت يُحسب في الأسئلة التي تجاوزت الوقت المسموح', async () => {
    const start = await request('/exam/POSTEX1/start', { method: 'POST', token: users.studentToken });
    const [q0] = start.body.data.questions;

    // السؤال الأول: خطأ ثم صواب — والسؤال الثاني لم يُجب (انتهى وقته)
    for (const option of [wrongOptionOf(q0), correctOptionOf(q0)]) {
      await request('/exam/POSTEX1/submit', {
        method: 'POST',
        token: users.studentToken,
        body: { questionId: q0._id, optionId: option._id },
      });
    }
    assert.equal((await answerUsefulness('POSTEX1')).status, 201);
    const res = await finishExam('POSTEX1');
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.skippedCount, 1);
  });

  test('إجابات ناقصة أو خارج المدى ترفض بـ400', async () => {
    for (const answers of [
      undefined,
      [],
      [5, 5, 5],
      postAnswers(5).slice(1), // عبارة ناقصة
      [...postAnswers(5), 5], // عبارة زائدة
      [...postAnswers(5).slice(1), 9],
      [...postAnswers(5).slice(1), 0],
      [...postAnswers(5).slice(1), 2.5],
      [...postAnswers(5).slice(1), 'x'],
      'nope',
    ]) {
      const res = await answerPost('POSTEX1', answers);
      assert.equal(res.status, 400, `${JSON.stringify(answers)} -> ${res.status}`);
      assert.doesNotMatch(res.body.message, /أكمل الاختبار أولًا/, 'الرفض للإجابات لا لترتيب الخطوات');
    }
  });

  test('يُحفظ مرة واحدة فقط', async () => {
    const post = await answerPost('POSTEX1', postAnswers(4));
    assert.equal(post.status, 201, post.body.message);
    const again = await answerPost('POSTEX1', postAnswers(1));
    assert.equal(again.status, 200);
    assert.equal(again.body.data.alreadySubmitted, true, 'لا يُسجَّل المقياس البعدي مرتين');
  });

  test('نتائج المقياس البعدي للمسؤول', async () => {
    const res = await request(`/stats/post-survey?exam=${fixture.exam._id}`, {
      token: users.adminToken,
    });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.responseCount, 1);
    assert.equal(res.body.data.items.length, POST_N);
    assert.deepEqual(res.body.data.students[0].scores, PATTERN);
    assert.equal(res.body.data.students[0].result, PATTERN_RESULT);
    assert.equal(res.body.data.overallAvg, PATTERN_RESULT);
  });

  test('نتائج المقياس البعدي محمية عن الطلاب', async () => {
    const res = await request(`/stats/post-survey?exam=${fixture.exam._id}`, {
      token: users.studentToken,
    });
    assert.equal(res.status, 403);
  });

  test('الاختبار المغلق بعد النتيجة لا يحرم الطالب من المقياس البعدي', async () => {
    const closing = await makeFeedbackExam({ questionCount: 1, code: 'CLOSEX1' });
    const start = await request('/exam/CLOSEX1/start', { method: 'POST', token: users.studentToken });
    const [q] = start.body.data.questions;
    await request('/exam/CLOSEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: correctOptionOf(q)._id },
    });
    await answerUsefulness('CLOSEX1');
    assert.equal((await finishExam('CLOSEX1')).status, 200);

    // المسؤول يغلق الاختبار والطالب لم يُجب عن المقياس البعدي بعد
    const closed = await request(`/exams/${closing.exam._id}/unpublish`, {
      method: 'POST',
      token: users.adminToken,
    });
    assert.equal(closed.status, 200, closed.body.message);

    const meta = await request('/exam/CLOSEX1', { token: users.studentToken });
    assert.equal(meta.status, 200, 'صفحة الاختبار تفتح له ليُكمل المقياس');
    assert.equal((await request('/exam/CLOSEX1')).status, 404, 'ولا تفتح لزائر');

    const resumed = await request('/exam/CLOSEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(resumed.status, 200, resumed.body.message);
    assert.equal(resumed.body.data.questionsFinished, true);

    assert.equal((await answerPost('CLOSEX1', postAnswers(4))).status, 201);
    const afterwards = await request('/exam/CLOSEX1', { token: users.studentToken });
    assert.equal(afterwards.status, 404, 'بعد المقياس يعود الاختبار مغلقًا عليه');
  });
});

describe('سجل الدرجات', () => {
  test('الأسئلة الخاطئة تُحسب بالسؤال لا بالمحاولة', async () => {
    await makeFeedbackExam({
      questionCount: 2,
      attemptsPerQuestion: 2,
      showScoreHistory: true,
      code: 'HISTEX1',
    });
    const start = await request('/exam/HISTEX1/start', {
      method: 'POST',
      token: users.studentToken,
    });
    const [q0, q1] = start.body.data.questions;

    // السؤال الأول: خطأ مرتين (نفدت محاولاته) — والثاني صحيح
    for (let i = 0; i < 2; i++) {
      await request('/exam/HISTEX1/submit', {
        method: 'POST',
        token: users.studentToken,
        body: { questionId: q0._id, optionId: q0.options.find((o) => !o.isCorrect)._id },
      });
    }
    await request('/exam/HISTEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q1._id, optionId: q1.options.find((o) => o.isCorrect)._id },
    });
    assert.equal((await answerUsefulness('HISTEX1')).status, 201);

    const res = await finishExam('HISTEX1', 40);
    assert.equal(res.status, 200, res.body.message);
    assert.ok(Array.isArray(res.body.data.history), 'سجل الدرجات مرسل');

    const row = res.body.data.history.find((h) => String(h.sessionId) === String(res.body.data.sessionId));
    assert.ok(row, 'الاختبار الحالي موجود في السجل');
    assert.equal(row.correctCount, 1);
    assert.equal(row.wrongQuestions, 1, 'سؤال واحد خاطئ وإن أخطأ فيه مرتين');
    assert.equal(row.wrongAttempts, 2);
    assert.equal(row.questionCount, 2);
    assert.ok(
      res.body.data.history.length >= 3,
      'السجل يشمل كل الاختبارات المكتملة'
    );
  });
});

describe('فتح الاختبار لطالب متأخر', () => {
  let closed;

  before(async () => {
    closed = await makeFeedbackExam({
      questionCount: 2,
      attemptsPerQuestion: 2,
      code: 'LATEEX1',
      isPublished: false,
    });
  });

  test('الاختبار المغلق لا يُفتح لزائر ولا لطالب بلا استثناء', async () => {
    assert.equal((await request('/exam/LATEEX1')).status, 404);
    assert.equal((await request('/exam/LATEEX1', { token: users.studentToken })).status, 404);
    const start = await request('/exam/LATEEX1/start', {
      method: 'POST',
      token: users.studentToken,
    });
    assert.equal(start.status, 404);
  });

  test('الاستثناء يحتاج طالبًا موجودًا', async () => {
    const bad = await request(`/exams/${closed.exam._id}/late-access`, {
      method: 'POST',
      token: users.adminToken,
      body: { userId: MISSING_ID },
    });
    assert.equal(bad.status, 404);

    const admin = await request(`/exams/${closed.exam._id}/late-access`, {
      method: 'POST',
      token: users.adminToken,
      body: { userId: users.admin._id },
    });
    assert.equal(admin.status, 404, 'المسؤول ليس طالبًا');
  });

  test('المسؤول يفتح الاختبار لطالب واحد فيعمل معه الرابط', async () => {
    const granted = await request(`/exams/${closed.exam._id}/late-access`, {
      method: 'POST',
      token: users.adminToken,
      body: { userId: users.student._id },
    });
    assert.equal(granted.status, 200, granted.body.message);
    assert.equal(granted.body.data.length, 1);

    const meta = await request('/exam/LATEEX1', { token: users.studentToken });
    assert.equal(meta.status, 200, meta.body.message);

    const start = await request('/exam/LATEEX1/start', {
      method: 'POST',
      token: users.studentToken,
    });
    assert.equal(start.status, 200, start.body.message);
  });

  test('الاستثناء لا يفتح الاختبار لبقية الطلاب ولا للزوار', async () => {
    assert.equal((await request('/exam/LATEEX1')).status, 404);
    const created = await request('/users', {
      method: 'POST',
      token: users.adminToken,
      body: { name: 'طالب آخر', username: 'latestu2', password: 'pass1234', role: 'student' },
    });
    assert.equal(created.status, 201, created.body.message);
    const otherToken = (
      await request('/auth/login', {
        method: 'POST',
        body: { identifier: 'latestu2', password: 'pass1234' },
      })
    ).body.token;

    assert.equal((await request('/exam/LATEEX1', { token: otherToken })).status, 404);
  });

  test('إلغاء الاستثناء يغلق الاختبار من جديد', async () => {
    const revoked = await request(`/exams/${closed.exam._id}/late-access/${users.student._id}`, {
      method: 'DELETE',
      token: users.adminToken,
    });
    assert.equal(revoked.status, 200, revoked.body.message);
    assert.equal(revoked.body.data.length, 0);
    assert.equal((await request('/exam/LATEEX1', { token: users.studentToken })).status, 404);
  });

  test('الطالب الذي أدّى الاختبار لا يُعاد له', async () => {
    const res = await request(`/exams/${fixture.exam._id}/late-access`, {
      method: 'POST',
      token: users.adminToken,
      body: { userId: users.student._id },
    });
    assert.equal(res.status, 409);
  });
});

describe('الاستئناف بعد إعادة التحميل', () => {
  let q0;
  let q1;

  before(async () => {
    await makeFeedbackExam({ questionCount: 2, attemptsPerQuestion: 2, code: 'RATEEX1' });
    const start = await request('/exam/RATEEX1/start', {
      method: 'POST',
      token: users.studentToken,
    });
    [q0, q1] = start.body.data.questions;
  });

  const resume = () => request('/exam/RATEEX1/start', { method: 'POST', token: users.studentToken });

  test('بداية الجلسة: كل الأسئلة بلا محاولات', async () => {
    const { progress } = (await resume()).body.data;
    assert.equal(progress.length, 2);
    for (const p of progress) {
      assert.equal(p.attempts, 0);
      assert.equal(p.isCorrect, false);
    }
  });

  test('سؤال محسوم يبقى محسومًا بعد إعادة التحميل ولا يُعاد', async () => {
    await request('/exam/RATEEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q0._id, optionId: correctOptionOf(q0)._id },
    });
    assert.equal((await resume()).body.data.progress[0].isCorrect, true);

    const again = await request('/exam/RATEEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q0._id, optionId: correctOptionOf(q0)._id },
    });
    assert.equal(again.status, 400);
  });

  test('آخر تغذية راجعة لإجابة خاطئة تعود عند الاستئناف', async () => {
    const wrong = wrongOptionOf(q1);
    await request('/exam/RATEEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q1._id, optionId: wrong._id },
    });

    const p1 = (await resume()).body.data.progress[1];
    assert.equal(p1.attempts, 1);
    assert.equal(p1.attemptsLeft, 1);
    assert.equal(p1.exhausted, false);
    assert.ok(p1.lastFeedback, 'التغذية الراجعة متاحة لإعادة عرضها');
    assert.equal(p1.lastFeedback.optionId, String(wrong._id));
    assert.ok(p1.lastFeedback.content.length > 0);
  });

  test('مقياس الفائدة المدركة يُطلب حتى يُجاب، وحالته تعود عند الاستئناف', async () => {
    assert.equal((await finishExam('RATEEX1')).status, 400, 'لا نتيجة قبل المقياس');
    assert.equal((await resume()).body.data.usefulnessDone, false);

    assert.equal((await answerUsefulness('RATEEX1')).status, 201);
    assert.equal((await resume()).body.data.usefulnessDone, true);
    assert.equal((await finishExam('RATEEX1')).status, 200);
    assert.equal((await resume()).body.data.questionsFinished, true, 'تعود الصفحة إلى النتيجة والمقياس');
  });
});

describe('عدد الطلاب في صفحة الاختبار', () => {
  let counted;

  before(async () => {
    counted = await makeFeedbackExam({ questionCount: 1, attemptsPerQuestion: 2, code: 'COUNTEX1' });
  });

  const countsOf = async () => {
    const res = await request(`/exams/${counted.exam._id}`, { token: users.adminToken });
    assert.equal(res.status, 200, res.body.message);
    return { done: res.body.data.completedCount, started: res.body.data.inProgressCount };
  };

  test('قبل أي طالب: صفر وصفر', async () => {
    assert.deepEqual(await countsOf(), { done: 0, started: 0 });
  });

  test('طالب بدأ ولم يُنهِ يُعدّ في «بدأ» لا في «أنهى»', async () => {
    await request('/exam/COUNTEX1/start', { method: 'POST', token: users.studentToken });
    assert.deepEqual(await countsOf(), { done: 0, started: 1 });
  });

  test('يُعدّ ضمن «أنهى» بعد المقياس البعدي فقط', async () => {
    const start = await request('/exam/COUNTEX1/start', {
      method: 'POST',
      token: users.studentToken,
    });
    const [q] = start.body.data.questions;
    await request('/exam/COUNTEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: q.options.find((o) => o.isCorrect)._id },
    });
    assert.equal((await answerUsefulness('COUNTEX1')).status, 201);
    const shown = await finishExam('COUNTEX1', 20);
    assert.equal(shown.status, 200, shown.body.message);
    assert.deepEqual(await countsOf(), { done: 0, started: 1 }, 'النتيجة معروضة لكنها لم تُسجَّل بعد');

    assert.equal((await answerPost('COUNTEX1', postAnswers(4))).status, 201);
    assert.deepEqual(await countsOf(), { done: 1, started: 0 });
  });
});

describe('حذف سجل طالب في اختبار تغذية راجعة', () => {
  let resetExam;
  let sessionId;

  // يُكمل الطالب الاختبار كاملًا: إجابة، مقياس الفائدة، إنهاء، مقياس بعدي
  const fullRun = async () => {
    const start = await request('/exam/RESETEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(start.status, 200, start.body.message);
    const [q] = start.body.data.questions;
    await request('/exam/RESETEX1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: q.options.find((o) => o.isCorrect)._id },
    });
    assert.equal((await answerUsefulness('RESETEX1')).status, 201);
    const done = await finishExam('RESETEX1');
    assert.equal(done.status, 200, done.body.message);
    assert.equal((await answerPost('RESETEX1', postAnswers(4))).status, 201);
  };

  before(async () => {
    resetExam = await makeFeedbackExam({ questionCount: 1, attemptsPerQuestion: 2, code: 'RESETEX1' });
    await fullRun();
  });

  test('قائمة السجلات تُظهر محاولة الطالب المنتهية', async () => {
    const res = await request(`/exams/${resetExam.exam._id}/sessions`, { token: users.adminToken });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].status, 'completed');
    assert.equal(res.body.data[0].correctCount, 1);
    assert.equal(res.body.data[0].usefulnessDone, true);
    assert.equal(res.body.data[0].postSurveyDone, true);
    sessionId = res.body.data[0].sessionId;
  });

  test('قبل الحذف: الطالب ممنوع من الإعادة', async () => {
    const res = await request('/exam/RESETEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(res.status, 409);
  });

  test('سجل من اختبار آخر لا يُحذف من هنا', async () => {
    const res = await request(`/exams/${fixture.exam._id}/sessions/${sessionId}`, {
      method: 'DELETE',
      token: users.adminToken,
    });
    assert.equal(res.status, 404);
  });

  test('الحذف للمسؤول فقط', async () => {
    const res = await request(`/exams/${resetExam.exam._id}/sessions/${sessionId}`, {
      method: 'DELETE',
      token: users.studentToken,
    });
    assert.equal(res.status, 403);
  });

  test('بعد الحذف: لا يبقى شيء من المحاولة', async () => {
    const res = await request(`/exams/${resetExam.exam._id}/sessions/${sessionId}`, {
      method: 'DELETE',
      token: users.adminToken,
    });
    assert.equal(res.status, 200, res.body.message);

    const list = await request(`/exams/${resetExam.exam._id}/sessions`, { token: users.adminToken });
    assert.equal(list.body.data.length, 0);

    const exam = await request(`/exams/${resetExam.exam._id}`, { token: users.adminToken });
    assert.equal(exam.body.data.completedCount, 0);

    const post = await request(`/stats/post-survey?exam=${resetExam.exam._id}`, { token: users.adminToken });
    assert.equal(post.body.data.responseCount, 0, 'المقياس البعدي حُذف');

    const useful = await request(`/stats/usefulness-survey?exam=${resetExam.exam._id}`, {
      token: users.adminToken,
    });
    assert.equal(useful.body.data.responseCount, 0, 'مقياس الفائدة المدركة حُذف');
  });

  test('الطالب يعيد الاختبار من جديد، ويُطلب منه المقياسان مرة أخرى', async () => {
    const start = await request('/exam/RESETEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(start.status, 200, start.body.message);
    assert.ok(start.body.data.progress.every((p) => p.attempts === 0), 'لا إجابات قديمة');
    assert.equal(start.body.data.usefulnessDone, false);
    assert.equal(start.body.data.postSurveyDone, false);
    // دورة كاملة ثانية: كانت ستُعدّ المقياسين مُجابين لو بقيت إجاباتهما القديمة
    await fullRun();
    const list = await request(`/exams/${resetExam.exam._id}/sessions`, { token: users.adminToken });
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].status, 'completed');
  });
});

describe('عبارات المقياس البعدي الجديدة', () => {
  test('عشرون عبارة، والاختيارات الخمسة ودرجاتها كما هي', () => {
    assert.equal(POST_N, 20);
    assert.deepEqual(POST_EXAM_SURVEY.choices, PREBUILT_SURVEY.choices);
    assert.equal(new Set(POST_EXAM_SURVEY.items).size, POST_N, 'لا عبارة مكررة');
  });

  test('رابط المقياس القبلي المستقل لم يتغير: ما زال بعباراته الثماني', () => {
    assert.equal(PREBUILT_SURVEY.items.length, 8);
    assert.ok(!PREBUILT_SURVEY.items.some((t) => POST_EXAM_SURVEY.items.includes(t)));
  });

  test('إجابات النسخة السابقة لا تُعرض تحت العبارات الجديدة', async () => {
    const legacyExam = await makeFeedbackExam({ questionCount: 1, code: 'LEGACYX1' });
    const examId = legacyExam.exam._id;
    const answersFor = (texts, score) =>
      texts.map((text, item) => ({ item, text, score, label: '' }));

    // طالب أجاب عن العبارات الثماني القديمة قبل التغيير
    await PostExamSurveyModel.create({
      user: users.student._id,
      exam: examId,
      session: new mongoose.Types.ObjectId(),
      answers: answersFor(PREBUILT_SURVEY.items, 1),
      totalScore: 8,
      itemCount: 8,
      result: 1,
    });
    // وطالب أجاب عن العبارات الجديدة
    await PostExamSurveyModel.create({
      user: users.student._id,
      exam: examId,
      session: new mongoose.Types.ObjectId(),
      answers: answersFor(POST_EXAM_SURVEY.items, 5),
      totalScore: 5 * POST_N,
      itemCount: POST_N,
      result: 5,
    });

    const res = await request(`/stats/post-survey?exam=${examId}`, { token: users.adminToken });
    assert.equal(res.status, 200, res.body.message);

    assert.equal(res.body.data.students.length, 1, 'الجدول الحالي فيه الإجابة الجديدة فقط');
    assert.deepEqual(res.body.data.students[0].scores, postAnswers(5));
    assert.equal(res.body.data.overallAvg, 5, 'المتوسط لا يخلط بين النسختين');

    assert.equal(res.body.data.legacy.length, 1);
    assert.deepEqual(
      res.body.data.legacy[0].answers.map((a) => a.text),
      PREBUILT_SURVEY.items,
      'الإجابة القديمة تعود بنصوص عباراتها'
    );
  });
});

describe('جلسة بدأت قبل تغيير الترتيب', () => {
  test('من أجاب عن المقياس البعدي قبل التسليم تُسجَّل نتيجته فور التسليم', async () => {
    const legacyExam = await makeFeedbackExam({ questionCount: 1, code: 'OLDORD1' });
    const start = await request('/exam/OLDORD1/start', { method: 'POST', token: users.studentToken });
    const [q] = start.body.data.questions;
    await request('/exam/OLDORD1/submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionId: q._id, optionId: correctOptionOf(q)._id },
    });

    // ما كان الترتيب القديم يحفظه: المقياس البعدي قبل الإنهاء
    await PostExamSurveyModel.create({
      user: users.student._id,
      exam: legacyExam.exam._id,
      session: start.body.data.sessionId,
      answers: POST_EXAM_SURVEY.items.map((text, item) => ({ item, text, score: 4, label: '' })),
      totalScore: 4 * POST_N,
      itemCount: POST_N,
      result: 4,
    });

    assert.equal((await answerUsefulness('OLDORD1')).status, 201);
    const res = await finishExam('OLDORD1');
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.recorded, true, 'لا يُطلب منه المقياس البعدي مرة ثانية');
    assert.equal(res.body.data.postSurveyDone, true);

    const exam = await request(`/exams/${legacyExam.exam._id}`, { token: users.adminToken });
    assert.equal(exam.body.data.completedCount, 1);
  });
});
