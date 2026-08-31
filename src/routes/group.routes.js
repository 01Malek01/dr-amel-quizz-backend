const express = require('express');
const {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} = require('../controllers/group.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/', listGroups);
router.post('/', createGroup);
router.put('/:id', updateGroup);
router.delete('/:id', deleteGroup);

module.exports = router;