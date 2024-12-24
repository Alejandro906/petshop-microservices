const express = require('express');
const { verifyAdmin, verifyUser } = require('./middleware/auth.js');
const Product = require('./models/product.js');
const Review = require('./models/review.js');
const User = require('./models/user.js');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const amqplib = require('amqplib');

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = 7002;
let channel, connection;

mongoose.connect(process.env.MONGO_URL);

async function setupRabbitMQ() {
  try {
    connection = await amqplib.connect('amqp://guest:guest@rabbitmq:5672');
    channel = await connection.createChannel();
    await channel.assertExchange('product_events', 'fanout');
    
    // Setup category event listener
    await channel.assertExchange('category_events', 'fanout');
    const q = await channel.assertQueue('product_category_updates');
    await channel.bindQueue(q.queue, 'category_events', '');
    
    channel.consume(q.queue, async (msg) => {
      const event = JSON.parse(msg.content);
      await handleCategoryEvent(event);
      channel.ack(msg);
    });
    
    console.log('RabbitMQ Connected Successfully');
  } catch (error) {
    console.error('RabbitMQ Setup Error:', error);
    await new Promise(resolve => setTimeout(resolve, 5000));
    return setupRabbitMQ();
  }
}

async function handleCategoryEvent(event) {
  try {
    switch (event.event) {
      case 'category_deactivated':
        await Product.updateMany(
          { category: event.categoryId },
          { category: null }
        );
        break;
      case 'category_updated':
        break;
    }
  } catch (error) {
    console.error('Error handling category event:', error);
  }
}

setupRabbitMQ()

app.get('/', async (req, res) => {
  try {
    const { category, animalType, page = 1, limit = 10 } = req.query;
    const query = {};
    if (category) query.category = category;
    if (animalType) query.animalType = animalType;

    const products = await Product.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.status(200).json(products);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to get all products',
      error: error.message
    });
  }
});

app.get('/:productId', async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json(product);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to get product',
      error: error.message
    });
  }
});

app.post('/', verifyAdmin, async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to create product',
      error: error.message
    });
  }
});

app.put('/:productId', verifyAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.productId,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    
    if (channel) {
      channel.publish(
        'product_events',
        '',
        Buffer.from(JSON.stringify({
          event: 'product_updated',
          product,
          timestamp: new Date()
        }))
      );
    }

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.delete('/:productId', verifyAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to delete product',
      error: error.message
    });
  }
});

app.get('/:productId/reviews', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId })
      .populate('userId', 'username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: reviews
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews',
      error: error.message
    });
  }
});

app.post('/:productId/reviews', verifyUser, async (req, res) => {
  try {
    const review = new Review({
      ...req.body,
      productId: req.params.productId,
      userId: req.user.userId
    });
    await review.save();

    const reviews = await Review.find({ productId: req.params.productId });
    const avgRating = reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length;
    await Product.findByIdAndUpdate(req.params.productId, { averageRating: avgRating });

    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      data: review
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to add review',
      error: error.message
    });
  }
});

app.put('/:productId/reviews/:reviewId', verifyUser, async (req, res) => {
  try {
    const review = await Review.findOne({
      _id: req.params.reviewId,
      userId: req.user.userId,
      productId: req.params.productId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    Object.assign(review, req.body);
    review.updatedAt = new Date();
    await review.save();

    const reviews = await Review.find({ productId: req.params.productId });
    const avgRating = reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length;
    await Product.findByIdAndUpdate(req.params.productId, { averageRating: avgRating });

    res.status(200).json({
      success: true,
      message: 'Review updated successfully',
      data: review
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to update review',
      error: error.message
    });
  }
});

app.delete('/:productId/reviews/:reviewId', verifyUser, async (req, res) => {
  try {
    const review = await Review.findOneAndDelete({
      _id: req.params.reviewId,
      userId: req.user.userId,
      productId: req.params.productId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const reviews = await Review.find({ productId: req.params.productId });
    const avgRating = reviews.length > 0
      ? reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length
      : 0;
    await Product.findByIdAndUpdate(req.params.productId, { averageRating: avgRating });

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete review',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Product service running on ${PORT}`);
});