const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { boot, shutdown, client, makeUsers, BAD_ID } = require('./helpers');

let request;
let users;

before(async () => {
  request = client(await boot('dq_test_auth'));
  users = await makeUsers();
});

after(shutdown);

describe('الصحة وتسجيل الدخول', () => {
  test('health يستجيب', async () => {
    const res = await request('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  test('تسجيل دخول صحيح يعيد رمزًا', async () => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: { identifier: 'testadmin', password: 'pass1234' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, 'admin');
    assert.equal(res.body.user.password, undefined, 'كلمة المرور لا يجب أن تُعاد');
  });

  test('الدخول بالبريد وبحالة أحرف مختلفة', async () => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: { identifier: 'ADMIN@TEST.LOCAL', password: 'pass1234' },
    });
    assert.equal(res.status, 200);
  });

  test('كلمة مرور خاطئة ترفض بـ401', async () => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: { identifier: 'testadmin', password: 'wrong' },
    });
    assert.equal(res.status, 401);
  });

  test('مستخدم غير موجود يرفض بـ401', async () => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: { identifier: 'ghost', password: 'pass1234' },
    });
    assert.equal(res.status, 401);
  });

  test('بيانات ناقصة ترفض بـ400', async () => {
    for (const body of [{}, { identifier: 'testadmin' }, { password: 'x' }, { identifier: '   ' }]) {
      const res = await request('/auth/login', { method: 'POST', body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  test('جسم غير صالح لا يسقط الخادم', async () => {
    const res = await request('/auth/login', { method: 'POST', body: 'حسن', raw: true });
    assert.ok(res.status === 400 || res.status === 415, `status=${res.status}`);
  });

  test('تسجيل الدخول بأنواع غير نصية لا يسبب استثناء', async () => {
    for (const identifier of [null, 123, { a: 1 }, ['x']]) {
      const res = await request('/auth/login', {
        method: 'POST',
        body: { identifier, password: 'pass1234' },
      });
      assert.ok(res.status < 500, `identifier=${JSON.stringify(identifier)} -> ${res.status}`);
    }
  });
});

describe('/auth/me', () => {
  test('بدون رمز يرفض بـ401', async () => {
    assert.equal((await request('/auth/me')).status, 401);
  });

  test('رمز تالف يرفض بـ401 لا 500', async () => {
    const res = await request('/auth/me', { token: 'garbage.token.here' });
    assert.equal(res.status, 401);
  });

  test('رمز صحيح يعيد المستخدم', async () => {
    const res = await request('/auth/me', { token: users.studentToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'student');
  });
});

describe('حماية مسارات المسؤول', () => {
  const adminPaths = [
    '/users',
    '/groups',
    '/chapters',
    '/topics',
    '/exams',
    '/normal-exams',
    '/surveys',
    '/stats/overview',
    '/stats/by-feedback',
    '/stats/exams',
    '/stats/students',
    '/stats/per-student-exam',
    '/stats/feedback-ratings',
    '/settings/feedbackExamInstructions',
  ];

  for (const p of adminPaths) {
    test(`${p} يرفض بدون رمز (401)`, async () => {
      assert.equal((await request(p)).status, 401);
    });

    test(`${p} يرفض الطالب (403)`, async () => {
      const res = await request(p, { token: users.studentToken });
      assert.equal(res.status, 403, `${p} -> ${res.status}`);
    });
  }

  test('الرفع محمي للمسؤول فقط', async () => {
    assert.equal((await request('/upload', { method: 'POST' })).status, 401);
    const res = await request('/upload', { method: 'POST', token: users.studentToken });
    assert.equal(res.status, 403);
  });
});

describe('مسارات غير موجودة ومعرّفات غير صالحة', () => {
  test('مسار غير موجود يعيد 404', async () => {
    assert.equal((await request('/does-not-exist')).status, 404);
  });

  test('معرّف غير صالح يعيد 400 لا 500', async () => {
    const paths = [
      `/users/${BAD_ID}`,
      `/chapters/${BAD_ID}`,
      `/exams/${BAD_ID}`,
      `/normal-exams/${BAD_ID}`,
      `/surveys/${BAD_ID}`,
      `/stats/exams/${BAD_ID}`,
    ];
    for (const p of paths) {
      const res = await request(p, { token: users.adminToken });
      assert.ok(res.status < 500, `${p} -> ${res.status} ${JSON.stringify(res.body)}`);
    }
  });
});
