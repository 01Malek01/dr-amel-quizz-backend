const express = require('express');
const {
  listChapters,
  getChapter,
  createChapter,
  updateChapter,
  deleteChapter,
} = require('../controllers/chapter.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/', listChapters);
router.get('/:id', getChapter);
router.post('/', createChapter);
router.put('/:id', updateChapter);
router.delete('/:id', deleteChapter);

module.exports = router;