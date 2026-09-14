const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, makeFeedbackExam, MISSING_ID } = require('./helpers');
const Session = require('../src/models/Session');

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
