const toSafeUser = (user) => {
  if (!user) return null;
  const doc = user._doc || user;
  return {
    _id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    nationalId: user.nationalId,
    role: user.role,
    isActive: user.isActive,
    group: user.group ? groupToSafe(user.group) : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: doc.createdAt,
  };
};

const groupToSafe = (group) => {
  if (!group) return null;
  if (typeof group === 'object' && group._id !== undefined) {
    return { _id: group._id, name: group.name, color: group.color, feedbackType: group.feedbackType };
  }
  return group;
};

module.exports = { toSafeUser, groupToSafe };