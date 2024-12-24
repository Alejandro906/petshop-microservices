const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  parentCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  imageUrl: String,
  active: { type: Boolean, default: true }
});

module.exports = mongoose.model('Category', categorySchema);