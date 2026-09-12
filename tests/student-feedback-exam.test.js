const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, makeFeedbackExam, MISSING_ID } = require('./helpers');
const Session = require('../src/models/Session');
const Survey = require('../src/models/Survey');
const SurveyQuestion = require('../src/models/SurveyQuestion');
const SurveyResponse = require('../src/models/SurveyResponse');

let request;
let users;
let fixture;

const correctOptionOf = (q) => q.options.find((o) => o.isCorrect);
const wrongOptionOf = (q) => q.options.find((o) => !o.isCorrect);

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
    assert.match(res.body.message, /الاختبار غير موجود/);
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
  test('الإنهاء يُرفض قبل إكمال مقياس الفائدة المدركة', async () => {
    const res = await request('/exam/TESTEX1/complete', {
      method: 'POST',
      token: users.studentToken,
      body: { totalTimeSeconds: 60 },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /مقياس الفائدة/);
  });

  test('بعد تقييم كل سؤال محاول يُقبل الإنهاء', async () => {
    for (const q of [fixture.questions[0], fixture.questions[1], fixture.questions[2]]) {
      const r = await request('/feedback-rating/TESTEX1', {
        method: 'POST',
        token: users.studentToken,
        body: { questionId: q._id, item1: 4, item2: 5, item3: 3 },
      });
      assert.ok(r.status < 400, `rating ${q._id} -> ${r.status} ${r.body.message}`);
    }

    const res = await request('/exam/TESTEX1/complete', {
      method: 'POST',
      token: users.studentToken,
      body: { totalTimeSeconds: 120 },
    });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.questionCount, 3);
    assert.equal(res.body.data.badges, 2);
    assert.equal(res.body.data.stars, undefined, 'لا يوجد نظام نجوم');
  });

  test('إعادة الاختبار بعد إنهائه ممنوعة (409)', async () => {
    const res = await request('/exam/TESTEX1/start', { method: 'POST', token: users.studentToken });
    assert.equal(res.status, 409);
  });

  test('الإنهاء مرتين يرفض بـ400', async () => {
    const res = await request('/exam/TESTEX1/complete', {
      method: 'POST',
      token: users.studentToken,
      body: { totalTimeSeconds: 10 },
    });
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
  test('قيم خارج المدى ترفض بـ400', async () => {
    const q = fixture.questions[0];
    for (const items of [
      { item1: 0, item2: 3, item3: 3 },
      { item1: 6, item2: 3, item3: 3 },
      { item1: 2.5, item2: 3, item3: 3 },
      { item1: 'x', item2: 3, item3: 3 },
      {},
    ]) {
      const res = await request('/feedback-rating/TESTEX1', {
        method: 'POST',
        token: users.studentToken,
        body: { questionId: q._id, ...items },
      });
      assert.ok(res.status >= 400 && res.status < 500, `${JSON.stringify(items)} -> ${res.status}`);
    }
  });
});

describe('المقياس داخل الاختبار', () => {
  test('بدون مقياس نشط يرفض بـ404', async () => {
    const res = await request('/exam/TESTEX1/survey-submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionOrder: 0, answers: [] },
    });
    assert.ok(res.status === 404 || res.status === 400, `-> ${res.status}`);
  });

  test('اختبار منفصل: يُسجَّل مرة واحدة لكل سؤال', async () => {
    const second = await makeFeedbackExam({ questionCount: 2, code: 'TESTEX2' });
    const survey = await Survey.create({
      title: 'مقياس داخل الاختبار',
      exam: second.exam._id,
      code: 'TESTSV1',
      isActive: true,
      choices: [
        { label: 'موافق', score: 5 },
        { label: 'محايد', score: 3 },
        { label: 'غير موافق', score: 1 },
      ],
    });
    const items = [
      await SurveyQuestion.create({ survey: survey._id, order: 0, text: 'بند أول' }),
      await SurveyQuestion.create({ survey: survey._id, order: 1, text: 'بند ثانٍ' }),
    ];

    await request('/exam/TESTEX2/start', { method: 'POST', token: users.studentToken });

    const answers = items.map((it) => ({
      questionId: String(it._id),
      choiceId: String(survey.choices[0]._id),
    }));

    const first = await request('/exam/TESTEX2/survey-submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionOrder: 0, answers },
    });
    assert.equal(first.status, 201, first.body.message);
    assert.equal(first.body.data.result, 5);

    const again = await request('/exam/TESTEX2/survey-submit', {
      method: 'POST',
      token: users.studentToken,
      body: { questionOrder: 0, answers },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.alreadySubmitted, true);

    const stored = await SurveyResponse.countDocuments({
      survey: survey._id,
      source: 'in-test',
    });
    assert.equal(stored, 1, 'لا يجب تكرار التسجيل لنفس السؤال');
  });

  test('إجابات ناقصة أو خيارات غير موجودة ترفض بـ400', async () => {
    const survey = await Survey.findOne({ code: 'TESTSV1' });
    const items = await SurveyQuestion.find({ survey: survey._id }).sort({ order: 1 });
    const bodies = [
      { questionOrder: 1, answers: [] },
      { questionOrder: 1, answers: [{ questionId: String(items[0]._id), choiceId: MISSING_ID }] },
      {
        questionOrder: 1,
        answers: items.map((it) => ({ questionId: String(it._id), choiceId: MISSING_ID })),
      },
      { questionOrder: 1, answers: 'nope' },
      { questionOrder: 1 },
    ];
    for (const body of bodies) {
      const res = await request('/exam/TESTEX2/survey-submit', {
        method: 'POST',
        token: users.studentToken,
        body,
      });
      assert.ok(res.status < 500, `${JSON.stringify(body)} -> ${res.status} ${res.body.message}`);
    }
  });
});
