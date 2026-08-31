const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'الاسم الكامل مطلوب'], trim: true },
    username: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    nationalId: { type: String, trim: true, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'student'], default: 'student' },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const bcrypt = require('bcryptjs');
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (candidate) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compare(candidate, this.password);
};

userSchema.statics.findByLoginIdentifier = function (identifier) {
  const value = String(identifier || '').trim().toLowerCase();
  return this.findOne({
    $or: [{ username: value }, { email: value }, { nationalId: value }],
  }).select('+password');
};

module.exports = mongoose.model('User', userSchema);