const express = require('express');
const { verifyAdmin } = require('./middleware/auth.js');
const Category = require('./models/category.js');
const mongoose = require('mongoose');
require('dotenv').config();
const amqplib = require('amqplib');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = 7004;

mongoose.connect(process.env.MONGO_URL);

let channel, connection;

async function setupRabbitMQ() {
  try {
    connection = await amqplib.connect('amqp://guest:guest@rabbitmq:5672');
    channel = await connection.createChannel();
    await channel.assertExchange('category_events', 'fanout');
    console.log('RabbitMQ Connected Successfully');
  } catch (error) {
    console.error('RabbitMQ Setup Error:', error);
    await new Promise(resolve => setTimeout(resolve, 5000));
    return setupRabbitMQ();
  }
}

setupRabbitMQ();

app.get('/', async (req, res) => {
  try {
    const categories = await Category.find({ active: true });
    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to get all categories',
      error: error.message
    });
  }
});

app.get('/:categoryId', async (req, res) => {
  try {
    const category = await Category.findById(req.params.categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to get category',
      error: error.message
    });
  }
});

app.post('/', verifyAdmin, async (req, res) => {
  try {
    const category = new Category(req.body);
    await category.save();

    if (channel) {
      channel.publish(
        'category_events',
        '',
        Buffer.from(JSON.stringify({
          event: 'category_created',
          category: category.toObject(),
          timestamp: new Date()
        }))
      );
    }

    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to create category',
      error: error.message
    });
  }
});

app.put('/:categoryId', verifyAdmin, async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(
      req.params.categoryId,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    if (channel) {
      channel.publish(
        'category_events',
        '',
        Buffer.from(JSON.stringify({
          event: 'category_updated',
          category: category.toObject(),
          timestamp: new Date()
        }))
      );
    }

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to update category',
      error: error.message
    });
  }
});

app.delete('/:categoryId', verifyAdmin, async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(
      req.params.categoryId,
      { active: false, updatedAt: new Date() },
      { new: true }
    );
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    if (channel) {
      channel.publish(
        'category_events',
        '',
        Buffer.from(JSON.stringify({
          event: 'category_deactivated',
          categoryId: category._id,
          timestamp: new Date()
        }))
      );
    }

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to delete category',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Category service running on ${PORT}`);
});