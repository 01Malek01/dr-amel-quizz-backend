const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, MISSING_ID, BAD_ID } = require('./helpers');

let request;
let users;
let ids = {};

before(async () => {
  request = client(await boot('dq_test_admin_crud'));
  users = await makeUsers();
});

after(shutdown);

const asAdmin = (path, opts = {}) => request(path, { ...opts, token: users.adminToken });

describe('الطلاب', () => {
  test('إنشاء طالب', async () => {
    const res = await asAdmin('/users', {
      method: 'POST',
      body: {
        name: 'طالب جديد',
        username: 'newstudent',
        email: 'new@test.local',
        password: 'pass1234',
        role: 'student',
      },
    });
    assert.equal(res.status, 201, res.body.message);
    ids.user = res.body.data._id;
    assert.equal(res.body.data.password, undefined, 'كلمة المرور لا تُعاد');
  });

  test('اسم مستخدم مكرر يرفض بـ409 لا 500', async () => {
    const res = await asAdmin('/users', {
      method: 'POST',
      body: { name: 'مكرر', username: 'newstudent', password: 'pass1234', role: 'student' },
    });
    assert.equal(res.status, 409, `-> ${res.status} ${res.body.message}`);
  });

  test('بيانات ناقصة ترفض بـ400', async () => {
    for (const body of [{}, { name: 'بلا كلمة مرور' }, { password: 'x' }]) {
      const res = await asAdmin('/users', { method: 'POST', body });
      assert.ok(res.status >= 400 && res.status < 500, `${JSON.stringify(body)} -> ${res.status}`);
    }
  });

  test('دور غير مسموح يرفض', async () => {
    const res = await asAdmin('/users', {
      method: 'POST',
      body: { name: 'x', username: 'roletest', password: 'pass1234', role: 'superadmin' },
    });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status}`);
  });

  test('جلب وتحديث وحذف الطالب', async () => {
    assert.equal((await asAdmin(`/users/${ids.user}`)).status, 200);

    const upd = await asAdmin(`/users/${ids.user}`, {
      method: 'PUT',
      body: { name: 'طالب مُحدَّث' },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.data.name, 'طالب مُحدَّث');

    assert.equal((await asAdmin(`/users/${ids.user}`, { method: 'DELETE' })).status, 200);
    assert.equal((await asAdmin(`/users/${ids.user}`)).status, 404);
  });

  test('طالب غير موجود يعيد 404', async () => {
    assert.equal((await asAdmin(`/users/${MISSING_ID}`)).status, 404);
  });
});

describe('المجموعات', () => {
  test('إنشاء مجموعة بنمط تغذية راجعة', async () => {
    const res = await asAdmin('/groups', {
      method: 'POST',
      body: { name: 'مجموعة أ', feedbackType: 'hint' },
    });
    assert.equal(res.status, 201, res.body.message);
    ids.group = res.body.data._id;
  });

  test('اسم مجموعة مكرر يرفض بـ409', async () => {
    const res = await asAdmin('/groups', { method: 'POST', body: { name: 'مجموعة أ' } });
    assert.equal(res.status, 409, `-> ${res.status}`);
  });

  test('نمط تغذية راجعة غير صالح يرفض بـ400', async () => {
    const res = await asAdmin('/groups', {
      method: 'POST',
      body: { name: 'مجموعة ب', feedbackType: 'nonsense' },
    });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status}`);
  });

  test('حذف المجموعة', async () => {
    assert.equal((await asAdmin(`/groups/${ids.group}`, { method: 'DELETE' })).status, 200);
  });
});

describe('شجرة المحتوى', () => {
  test('إنشاء موديول', async () => {
    const res = await asAdmin('/chapters', { method: 'POST', body: { title: 'الموديول الأول' } });
    assert.equal(res.status, 201, res.body.message);
    ids.chapter = res.body.data._id;
  });

  test('موديول بلا عنوان يرفض بـ400', async () => {
    const res = await asAdmin('/chapters', { method: 'POST', body: {} });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status}`);
  });

  test('إنشاء موضوع داخل الموديول', async () => {
    const res = await asAdmin('/topics', {
      method: 'POST',
      body: { title: 'الموضوع الأول', chapter: ids.chapter },
    });
    assert.equal(res.status, 201, res.body.message);
    ids.topic = res.body.data._id;
  });

  test('موضوع بموديول غير موجود يرفض', async () => {
    const res = await asAdmin('/topics', {
      method: 'POST',
      body: { title: 'موضوع يتيم', chapter: MISSING_ID },
    });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status}`);
  });

  test('موضوع بمعرّف موديول غير صالح يرفض بـ400 لا 500', async () => {
    const res = await asAdmin('/topics', {
      method: 'POST',
      body: { title: 'موضوع', chapter: BAD_ID },
    });
    assert.ok(res.status < 500, `-> ${res.status} ${res.body.message}`);
  });
});

describe('الاختبارات وأسئلتها', () => {
  test('إنشاء اختبار', async () => {
    const res = await asAdmin('/exams', {
      method: 'POST',
      body: { title: 'اختبار الإدارة', topic: ids.topic, feedbackType: 'hint' },
    });
    assert.equal(res.status, 201, res.body.message);
    ids.exam = res.body.data._id;
  });

  test('نشر اختبار بلا أسئلة يرفض', async () => {
    const res = await asAdmin(`/exams/${ids.exam}/publish`, { method: 'POST' });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status} ${res.body.message}`);
  });

  test('حفظ الأسئلة', async () => {
    const res = await asAdmin(`/exams/${ids.exam}/questions`, {
      method: 'PUT',
      body: {
        questions: [
          {
            _id: null,
            text: 'سؤال إداري',
            options: [
              { text: 'صحيحة', isCorrect: true, feedback: {} },
              { text: 'خاطئة', isCorrect: false, feedback: { hint: 'تلميح' } },
            ],
          },
        ],
      },
    });
    assert.equal(res.status, 200, res.body.message);
  });

  test('سؤال بلا إجابة صحيحة يرفض بـ400', async () => {
    const res = await asAdmin(`/exams/${ids.exam}/questions`, {
      method: 'PUT',
      body: {
        questions: [
          {
            _id: null,
            text: 'سؤال بلا إجابة صحيحة',
            options: [
              { text: 'أ', isCorrect: false, feedback: {} },
              { text: 'ب', isCorrect: false, feedback: {} },
            ],
          },
        ],
      },
    });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status} ${res.body.message}`);
  });

  test('سؤال بإجابة واحدة فقط يرفض', async () => {
    const res = await asAdmin(`/exams/${ids.exam}/questions`, {
      method: 'PUT',
      body: {
        questions: [
          { _id: null, text: 'سؤال ناقص', options: [{ text: 'أ', isCorrect: true, feedback: {} }] },
        ],
      },
    });
    assert.ok(res.status >= 400 && res.status < 500, `-> ${res.status} ${res.body.message}`);
  });

  test('النشر ثم إيقاف النشر', async () => {
    const pub = await asAdmin(`/exams/${ids.exam}/publish`, { method: 'POST' });
    assert.equal(pub.status, 200, pub.body.message);
    assert.ok(pub.body.data.code, 'يجب توليد رمز عند النشر');
    ids.examCode = pub.body.data.code;

    const unpub = await asAdmin(`/exams/${ids.exam}/unpublish`, { method: 'POST' });
    assert.equal(unpub.status, 200);
  });

  test('اختبار غير منشور لا يظهر للطلاب', async () => {
    const res = await request(`/exam/${ids.examCode}`);
    assert.equal(res.status, 404);
  });

  test('حذف الاختبار', async () => {
    assert.equal((await asAdmin(`/exams/${ids.exam}`, { method: 'DELETE' })).status, 200);
    assert.equal((await asAdmin(`/exams/${ids.exam}`)).status, 404);
  });
});

describe('التعليمات (settings)', () => {
  test('قراءة مفتاح غير موجود لا تفشل', async () => {
    const res = await asAdmin('/settings/feedbackExamInstructions');
    assert.equal(res.status, 200, res.body.message);
  });

  test('كتابة ثم قراءة التعليمات', async () => {
    const put = await asAdmin('/settings/feedbackExamInstructions', {
      method: 'PUT',
      body: { value: 'تعليمات الاختبار البنائي' },
    });
    assert.equal(put.status, 200, put.body.message);

    const get = await asAdmin('/settings/feedbackExamInstructions');
    assert.equal(get.body.data.value, 'تعليمات الاختبار البنائي');
  });
});

describe('الإحصائيات لا ترمي استثناءات على بيانات فارغة', () => {
  const paths = [
    '/stats/overview',
    '/stats/by-feedback',
    '/stats/exams',
    '/stats/students',
    '/stats/per-student-exam',
    '/stats/feedback-ratings',
  ];
  for (const p of paths) {
    test(`${p} يستجيب 200`, async () => {
      const res = await asAdmin(p);
      assert.equal(res.status, 200, `${p} -> ${res.status} ${res.body.message}`);
    });
  }

  test('feedback-ratings بمعرّف طالب غير صالح لا يعطي 500', async () => {
    const res = await asAdmin(`/stats/feedback-ratings?student=${BAD_ID}`);
    assert.ok(res.status < 500, `-> ${res.status} ${res.body.message}`);
  });

  test('per-student-exam بمعرّفات غير صالحة لا يعطي 500', async () => {
    const res = await asAdmin(`/stats/per-student-exam?exam=${BAD_ID}&student=${BAD_ID}`);
    assert.ok(res.status < 500, `-> ${res.status} ${res.body.message}`);
  });

  test('per-student-exam بتواريخ غير صالحة لا يعطي 500', async () => {
    const res = await asAdmin('/stats/per-student-exam?from=not-a-date&to=also-bad');
    assert.ok(res.status < 500, `-> ${res.status} ${res.body.message}`);
  });
});
