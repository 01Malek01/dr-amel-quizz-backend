const FEEDBACK_TYPES = ['hint', 'roadmap', 'link', 'explanation'];

const FEEDBACK_TYPE_LABELS = {
  hint: 'تلميح',
  roadmap: 'خارطة الطريق للإجابة',
  link: 'رابط للمراجعة',
  explanation: 'شرح مباشر',
};

const FEEDBACK_TYPE_DESCRIPTIONS = {
  hint: 'معلومة صغيرة تساعد الطالب على التفكير مرة أخرى قبل إعادة المحاولة.',
  roadmap: 'خطوات متسلسلة تقود للإجابة الصحيحة.',
  link: 'رابط لمُراجعة الموضوع ليقرأه الطالب ثم يعود للإجابة.',
  explanation: 'شرح واضح ومباشر يدل الطالب على سبب خطأ إجابته.',
};

const ROLES = ['admin', 'student'];

module.exports = {
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPE_DESCRIPTIONS,
  ROLES,
};