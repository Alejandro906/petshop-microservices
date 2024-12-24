const express = require('express');
const axios = require('axios');
const { verifyToken, verifyUser } = require('./middleware/auth.js');
const Cart = require('./models/cart.js');
const mongoose = require('mongoose');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const amqplib = require('amqplib');
const Product = require('./models/product.js')

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = 7003;
let channel, connection;

const PRODUCT_SERVICE_URL = 'http://product-service:7002';

async function verifyProduct(productId, quantity) {
  try {
    console.log(`Attempting to verify product. URL: ${PRODUCT_SERVICE_URL}/${productId}`);
    console.log('Product ID:', productId);
    console.log('Quantity:', quantity);

    const response = await axios.get(`${PRODUCT_SERVICE_URL}/${productId}`);
    console.log('Product service response:', response.data);

    const product = response.data;
    return {
      isAvailable: product.stock >= quantity,
      price: product.price,
      product
    };
  } catch (error) {
    console.error('Detailed error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      config: {
        url: error.config?.url,
        method: error.config?.method
      }
    });
    throw new Error('Failed to verify product');
  }
}

async function setupRabbitMQ() {
  try {
    connection = await amqplib.connect('amqp://guest:guest@rabbitmq:5672');
    channel = await connection.createChannel();
    
    // Setup exchange and queue for product events
    await channel.assertExchange('product_events', 'fanout');
    const q = await channel.assertQueue('cart_product_updates');
    await channel.bindQueue(q.queue, 'product_events', '');
    
    // Listen for product events
    channel.consume(q.queue, async (msg) => {
      const event = JSON.parse(msg.content);
      if (event.event === 'product_updated') {
        await handleProductUpdate(event.product);
      }
      channel.ack(msg);
    });

  } catch (error) {
    console.error('RabbitMQ Setup Error:', error);
    // Retry after 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));
    return setupRabbitMQ();
  }
}

// Handle product updates automatically
async function handleProductUpdate(updatedProduct) {
  try {
    // Update all cart items that contain this product
    await Cart.updateMany(
      { 'items.productId': updatedProduct._id },
      { 
        $set: { 
          'items.$.price': updatedProduct.price 
        }
      }
    );

    // Recalculate total amounts
    const carts = await Cart.find({ 'items.productId': updatedProduct._id });
    for (const cart of carts) {
      cart.totalAmount = cart.items.reduce((total, item) => 
        total + (item.price * item.quantity), 0
      );
      await cart.save();
    }
  } catch (error) {
    console.error('Error handling product update:', error);
  }
}

setupRabbitMQ()

mongoose.connect(process.env.MONGO_URL);

app.get('/', verifyToken, async (req, res) => {
  try {
    let cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart) {
      cart = new Cart({ userId: req.user.userId, items: [] });
      await cart.save();
      return res.json(cart);
    }

    // Fetch product details for each item in the cart
    const cartWithProducts = { ...cart.toObject() };
    for (let i = 0; i < cart.items.length; i++) {
      try {
        const response = await axios.get(`${PRODUCT_SERVICE_URL}/${cart.items[i].productId}`);
        cartWithProducts.items[i].productId = response.data; // Replace ID with full product details
      } catch (error) {
        console.error(`Failed to fetch product ${cart.items[i].productId}:`, error.message);
        // Keep the productId as is if fetch fails
      }
    }

    res.json(cartWithProducts);
  } catch (error) {
    console.error('Cart fetch error:', error);
    res.status(500).json({ message: error.message });
  }
});

app.post('/', verifyToken, async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    
    const { isAvailable, price, product } = await verifyProduct(productId, quantity);
    if (!isAvailable) {
      return res.status(400).json({ 
        message: 'Product not available in requested quantity' 
      });
    }

    let cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart) {
      cart = new Cart({ userId: req.user.userId, items: [] });
    }

    const itemIndex = cart.items.findIndex(item => 
      item.productId.toString() === productId
    );

    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += quantity;
    } else {
      cart.items.push({
        productId,
        quantity,
        price: product.price
      });
    }

    cart.totalAmount = cart.items.reduce((total, item) => 
      total + (item.price * item.quantity), 0
    );

    await cart.save();
    res.json(cart);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.put('/:itemId', verifyUser, async (req, res) => {
  try {
    const { quantity } = req.body;
    const cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    const itemIndex = cart.items.findIndex(item => 
      item._id.toString() === req.params.itemId
    );

    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not found in cart' });
    }

    const { isAvailable, product } = await verifyProduct(
      cart.items[itemIndex].productId,
      quantity
    );
    
    if (!isAvailable) {
      return res.status(400).json({ 
        message: 'Product not available in requested quantity' 
      });
    }

    cart.items[itemIndex].quantity = quantity;
    cart.items[itemIndex].price = product.price;
    
    cart.totalAmount = cart.items.reduce((total, item) => 
      total + (item.price * item.quantity), 0
    );

    await cart.save();
    res.json(cart);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.delete('/:itemId', verifyUser, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    cart.items = cart.items.filter(item => 
      item._id.toString() !== req.params.itemId
    );

    cart.totalAmount = cart.items.reduce((total, item) => 
      total + (item.price * item.quantity), 0
    );

    await cart.save();
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/', verifyToken, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.userId });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }

    cart.items = [];
    cart.totalAmount = 0;
    await cart.save();

    res.json({ message: 'Cart cleared successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Cart service running on ${PORT}`);
});