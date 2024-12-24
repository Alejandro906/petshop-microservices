const express = require('express');
const amqplib = require('amqplib');
const axios = require('axios');
const { verifyToken, verifyUser, verifyAdmin } = require('./middleware/auth.js');
const Order = require('./models/order.js');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = 7005;
const PRODUCT_SERVICE_URL = 'http://product-service:7002';
const CART_SERVICE_URL = 'http://cart-service:7003';

let channel, connection;

async function verifyProductAvailability(productId, quantity) {
  try {
    // Convert ObjectId to string if it's an ObjectId
    const productIdString = productId.toString();
    console.log(`Verifying product availability for ID: ${productIdString}`);
    
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/${productIdString}`);
    const product = response.data;
    
    return {
      isAvailable: product.stock >= quantity,
      name: product.name,
      price: product.price,
      product
    };
  } catch (error) {
    console.error('Product verification failed:', error);
    throw new Error(`Product verification failed: ${error.message}`);
  }
}

async function getCartItems(userId, accessToken) {
  try {
    const response = await axios.get(CART_SERVICE_URL, {
      headers: { 
        Cookie: `access_token=${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Cart retrieval failed:', error);
    throw new Error('Failed to get cart items');
  }
}

async function setupRabbitMQ() {
  try {
    connection = await amqplib.connect('amqp://guest:guest@rabbitmq:5672');
    channel = await connection.createChannel();
    
    await channel.assertExchange('order_events', 'fanout');
    await channel.assertExchange('product_events', 'fanout');
    
    const q = await channel.assertQueue('order_product_updates');
    await channel.bindQueue(q.queue, 'product_events', '');
    
    channel.consume(q.queue, async (msg) => {
      const event = JSON.parse(msg.content);
      await handleProductEvent(event);
      channel.ack(msg);
    });

    console.log('RabbitMQ Connected Successfully');
  } catch (error) {
    console.error('RabbitMQ Setup Error:', error);
    await new Promise(resolve => setTimeout(resolve, 5000));
    return setupRabbitMQ();
  }
}

async function handleProductEvent(event) {
  try {
    if (event.event === 'product_updated') {
      await Order.updateMany(
        { 'items.productId': event.product._id },
        { 
          $set: { 
            'items.$.price': event.product.price,
            updatedAt: new Date()
          }
        }
      );
    }
  } catch (error) {
    console.error('Error handling product event:', error);
  }
}

mongoose.connect(process.env.MONGO_URL);
setupRabbitMQ();

app.post('/', verifyToken, async (req, res) => {
  try {
    const cart = await getCartItems(
      req.user.userId, 
      req.cookies.access_token
    );
    
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }

    // Verify all products availability and collect verified items
    const verifiedItems = [];
    for (const item of cart.items) {
      // Handle both populated and unpopulated productId
      const productId = item.productId._id || item.productId;
      const result = await verifyProductAvailability(productId, item.quantity);
      
      if (!result.isAvailable) {
        return res.status(400).json({
          success: false,
          message: `Product ${result.name} is not available in requested quantity`
        });
      }

      verifiedItems.push({
        productId: productId,
        quantity: item.quantity,
        price: result.price
      });
    }

    const order = new Order({
      userId: req.user.userId,
      items: verifiedItems,
      totalAmount: verifiedItems.reduce((total, item) => total + (item.price * item.quantity), 0),
      shippingAddress: req.body.shippingAddress,
      paymentMethod: req.body.paymentMethod,
      orderStatus: 'processing'
    });

    await order.save();

    if (channel) {
      channel.publish(
        'order_events',
        '',
        Buffer.from(
          JSON.stringify({
            event: 'order_created',
            order: order.toObject(),
            timestamp: new Date()
          })
        )
      );
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order
    });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  }
});

app.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const orders = await Order.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get orders',
      error: error.message
    });
  }
});

app.get('/:orderId', verifyUser, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      userId: req.user.userId
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get order',
      error: error.message
    });
  }
});

app.put('/:orderId/cancel', verifyUser, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      userId: req.user.userId,
      orderStatus: 'processing'
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or cannot be cancelled'
      });
    }

    order.orderStatus = 'cancelled';
    order.updatedAt = new Date();
    await order.save();

    if (channel) {
      channel.publish(
        'order_events',
        '',
        Buffer.from(
          JSON.stringify({
            event: 'order_cancelled',
            order: order.toObject(),
            timestamp: new Date()
          })
        )
      );
    }

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order',
      error: error.message
    });
  }
});

app.put('/:orderId/status', verifyAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const previousStatus = order.orderStatus;
    order.orderStatus = req.body.status;
    order.updatedAt = new Date();
    await order.save();

    if (channel) {
      channel.publish(
        'order_events',
        '',
        Buffer.from(
          JSON.stringify({
            event: 'order_status_changed',
            order: order.toObject(),
            previousStatus,
            timestamp: new Date()
          })
        )
      );
    }

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update order status',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Order service running on ${PORT}`);
});