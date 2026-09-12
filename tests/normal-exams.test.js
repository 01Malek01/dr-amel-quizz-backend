const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, MISSING_ID } = require('./helpers');

let request;
let users;
let examId;
let examCode;
let questionIds = [];
let options = [];

before(async () => {
  request = client(await boot('dq_test_normal_exams'));
  users = await makeUsers();
});

after(shutdown);

const asAdmin = (path, opts = {}) => request(path, { ...opts, token: users.adminToken });

describe('إدارة الاختبارات العادية', () => {
  test('إنشاء اختبار عادي', async () => {
    const res = await asAdmin('/normal-exams', {
      method: 'POST',
      body: { title: 'اختبار عادي للفحص', totalGrade: 100 },
    });
    assert.equal(res.status, 201, res.body.message);
    examId = res.body.data._id;
    examCode = res.body.data.code;
    assert.ok(examCode);
  });

  test('درجة كلية غير صالحة ترفض بـ400', async () => {
    for (const totalGrade of [0, -5, 'abc', undefined, null]) {
      const res = await asAdmin('/normal-exams', {
        method: 'POST',
        body: { title: 'درجة سيئة', totalGrade },
      });
      assert.equal(res.status, 400, `totalGrade=${totalGrade} -> ${res.status}`);
    }
  });

  test('عنوان مفقود يرفض بـ400', async () => {
    const res = await asAdmin('/normal-exams', { method: 'POST', body: { totalGrade: 50 } });
    assert.equal(res.status, 400);
  });

  test('حفظ الأسئلة', async () => {
    const res = await asAdmin(`/normal-exams/${examId}/questions`, {
      method: 'PUT',
      body: {
        questions: [
          {
            _id: null,
            text: 'سؤال عادي أول',
            options: [
              { text: 'صحيحة', isCorrect: true },
              { text: 'خاطئة', isCorrect: false },
            ],
          },
          {
            _id: null,
            text: 'سؤال عادي ثانٍ',
            options: [
              { text: 'صحيحة', isCorrect: true },
              { text: 'خاطئة', isCorrect: false },
            ],
          },
        ],
      },
    });
    assert.equal(res.status, 200, res.body.message);
    questionIds = res.body.data.map((q) => String(q._id));
    options = res.body.data.map((q) => q.options);
  });

  test('سؤال بلا إجابة صحيحة يرفض', async () => {
    const res = await asAdmin(`/normal-exams/${examId}/questions`, {
      method: 'PUT',
      body: {
        questions: [
          {
            _id: null,
            text: 'بلا صحيحة',
            options: [
              { text: 'أ', isCorrect: false },
              { text: 'ب', isCorrect: false },
            ],
          },
        ],
      },
    });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status} ${res.body.message}`);
  });

  test('تفعيل الاختبار', async () => {
    const res = await asAdmin(`/normal-exams/${examId}/active`, {
      method: 'POST',
      body: { active: true },
    });
    assert.equal(res.status, 200, res.body.message);
  });
});

describe('أداء الطالب للاختبار العادي', () => {
  test('بيانات الاختبار متاحة بدون تسجيل دخول', async () => {
    const res = await request(`/normal-exam/${examCode}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.available, true);
  });

  test('رمز غير موجود يعيد 404', async () => {
    assert.equal((await request('/normal-exam/NOPE9999')).status, 404);
  });

  test('الأسئلة تحتاج تسجيل دخول', async () => {
    assert.equal((await request(`/normal-exam/${examCode}/questions`)).status, 401);
  });

  test('الأسئلة لا تكشف الإجابة الصحيحة', async () => {
    const res = await request(`/normal-exam/${examCode}/questions`, { token: users.studentToken });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(JSON.stringify(res.body.data.questions).includes('isCorrect'), false);
  });

  test('تسليم صحيح يحسب الدرجة', async () => {
    const answers = questionIds.map((qid, i) => ({
      questionId: qid,
      optionId: String(options[i].find((o) => o.isCorrect || o.text === 'صحيحة')._id),
    }));
    const res = await request(`/normal-exam/${examCode}/submit`, {
      method: 'POST',
      token: users.studentToken,
      body: { answers, totalTimeSeconds: 60 },
    });
    assert.equal(res.status, 201, res.body.message);
    assert.equal(res.body.data.correctCount, 2);
    assert.equal(res.body.data.grade, 100);
  });

  test('لا يمكن التسليم مرتين', async () => {
    const res = await request(`/normal-exam/${examCode}/submit`, {
      method: 'POST',
      token: users.studentToken,
      body: { answers: [], totalTimeSeconds: 10 },
    });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status} ${res.body.message}`);
  });

  test('تسليم بأشكال بيانات غير متوقعة لا يسبب 500', async () => {
    const login = await asAdmin('/users', {
      method: 'POST',
      body: { name: 'طالب ثالث', username: 'stu3', password: 'pass1234', role: 'student' },
    });
    assert.equal(login.status, 201, login.body.message);
    const tok = (
      await request('/auth/login', {
        method: 'POST',
        body: { identifier: 'stu3', password: 'pass1234' },
      })
    ).body.token;

    for (const body of [
      {},
      { answers: 'nope' },
      { answers: [{ questionId: 'bad', optionId: 'bad' }] },
      { answers: [{ questionId: MISSING_ID, optionId: MISSING_ID }] },
      { answers: [{}] },
      { answers: [{ questionId: questionIds[0] }] },
      { answers: null, totalTimeSeconds: 'x' },
    ]) {
      const res = await request(`/normal-exam/${examCode}/submit`, {
        method: 'POST',
        token: tok,
        body,
      });
      assert.ok(res.status < 500, `${JSON.stringify(body)} -> ${res.status} ${res.body.message}`);
    }
  });

  test('نتائج الاختبار للمسؤول', async () => {
    const res = await asAdmin(`/normal-exams/${examId}/results`);
    assert.equal(res.status, 200, res.body.message);
    assert.ok(Array.isArray(res.body.data.results || res.body.data));
  });
});

describe('نافذة التوقيت', () => {
  test('اختبار لم يبدأ بعد غير متاح', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const later = new Date(Date.now() + 172800000).toISOString();
    const created = await asAdmin('/normal-exams', {
      method: 'POST',
      body: { title: 'مجدول', totalGrade: 20, startsAt: future, endsAt: later },
    });
    assert.equal(created.status, 201, created.body.message);
    await asAdmin(`/normal-exams/${created.body.data._id}/active`, {
      method: 'POST',
      body: { active: true },
    });

    const meta = await request(`/normal-exam/${created.body.data.code}`);
    assert.equal(meta.status, 200);
    assert.equal(meta.body.data.available, false, 'لا يجب أن يكون متاحًا قبل موعده');

    const submit = await request(`/normal-exam/${created.body.data.code}/submit`, {
      method: 'POST',
      token: users.studentToken,
      body: { answers: [] },
    });
    assert.ok(submit.status >= 400 && submit.status < 500, `-> ${submit.status}`);
  });

  test('اختبار انتهى وقته غير متاح', async () => {
    const past = new Date(Date.now() - 172800000).toISOString();
    const ended = new Date(Date.now() - 86400000).toISOString();
    const created = await asAdmin('/normal-exams', {
      method: 'POST',
      body: { title: 'منتهٍ', totalGrade: 20, startsAt: past, endsAt: ended },
    });
    await asAdmin(`/normal-exams/${created.body.data._id}/active`, {
      method: 'POST',
      body: { active: true },
    });

    const meta = await request(`/normal-exam/${created.body.data.code}`);
    assert.equal(meta.body.data.available, false, 'لا يجب أن يكون متاحًا بعد انتهائه');
  });

  test('اختبار غير مفعّل غير متاح', async () => {
    const created = await asAdmin('/normal-exams', {
      method: 'POST',
      body: { title: 'معطّل', totalGrade: 20 },
    });
    const meta = await request(`/normal-exam/${created.body.data.code}`);
    assert.equal(meta.body.data.available, false);
  });
});
