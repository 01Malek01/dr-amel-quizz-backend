const { ApiError } = require('./ApiError');

const isObjectId = (value) => !!value && /^[0-9a-f]{24}$/i.test(String(value));

const firstValidationMessage = (error) => {
  const paths = Object.values(error.errors || {});
  return paths.length > 0 ? paths[0].message : error.message;
};

/*
 * يحفظ قائمة أسئلة اختبار كاملة (استبدال الموجود بالمُرسل).
 *
 * الحفظ على مرحلتين عن قصد: تُبنى كل المستندات وتُتحقَّق أولًا، ولا تُكتب أي
 * واحدة قبل أن تنجح جميعها. وإلا فإن سؤالًا خاطئًا في منتصف القائمة يترك ما
 * قبله محفوظًا وما بعده مفقودًا، فيرى المسؤول رسالة خطأ ويعود ليجد عدد
 * الأسئلة ناقصًا.
 *
 * كما تُعالَج المعرّفات بحذر: المعرّف المكرّر أو المحذوف أو التابع لاختبار آخر
 * يصبح سؤالًا جديدًا، فلا يُفقد سؤال ولا تُمسّ أسئلة اختبار آخر.
 */
async function persistQuestions({ Model, examId, questions, buildDoc }) {
  if (questions.length === 0) {
    await Model.deleteMany({ exam: examId });
    return [];
  }

  // المرحلة الأولى: البناء والتحقق بلا أي كتابة
  const prepared = questions.map((raw, index) => {
    const doc = buildDoc(raw, index);
    const validationError = new Model(doc).validateSync();
    if (validationError) {
      throw new ApiError(400, `السؤال ${index + 1}: ${firstValidationMessage(validationError)}`);
    }
    return { rawId: raw._id, doc };
  });

  const existingIds = new Set(
    (await Model.find({ exam: examId }).select('_id')).map((q) => String(q._id))
  );
  const claimed = new Set();
  for (const item of prepared) {
    const id = String(item.rawId || '');
    item.id = isObjectId(id) && existingIds.has(id) && !claimed.has(id) ? id : null;
    if (item.id) claimed.add(item.id);
  }

  // المرحلة الثانية: الكتابة
  const keptIds = [];
  for (const item of prepared) {
    if (item.id) {
      await Model.updateOne({ _id: item.id, exam: examId }, item.doc);
      keptIds.push(item.id);
      continue;
    }
    const created = await Model.create(item.doc);
    keptIds.push(created._id);
  }

  await Model.deleteMany({ exam: examId, _id: { $nin: keptIds } });

  const stored = await Model.find({ exam: examId }).sort({ order: 1 });
  if (stored.length !== questions.length) {
    // لا ينبغي أن يحدث. الفشل الصريح أفضل من إرجاع عدد أقل بصمت.
    throw new ApiError(
      500,
      `حُفظ ${stored.length} سؤالًا من ${questions.length}. لم يُطبَّق الحفظ كاملًا — أعد المحاولة.`
    );
  }
  return stored;
}

module.exports = { persistQuestions, isObjectId };
