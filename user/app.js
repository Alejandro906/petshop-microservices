const express = require('express');
const { verifyAdmin, verifyUser } = require('./middleware/auth.js')
const Product = require('./models/product.js')
const User = require('./models/user.js')
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors')
require('dotenv').config();

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

const PORT = 7001;

mongoose.connect(process.env.MONGO_URL);

app.post('/register', async (req, res) => {
  try {
    const { username, email, firstName, lastName, phoneNumber, addresses, isAdmin } = req.body;
    const hashPassword = await bcrypt.hash(req.body.password, 10);
    
    const user = new User({
      username,
      password: hashPassword,
      email,
      firstName,
      lastName,
      phoneNumber,
      addresses,
      isAdmin: isAdmin
    });

    await user.save();
    const { password, ...userData } = user._doc;

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: userData
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

app.post('/login', async (req, res) => {
  try {
      const user = await User.findOne({ email: req.body.email });
      if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
          return res.status(401).json({
              success: false,
              message: 'Invalid login credentials'
          });
      }

      const token = jwt.sign(
          {
              userId: user._id,
              isAdmin: user.isAdmin
          },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
      );

      user.lastLogin = new Date();
      await user.save();

      const { password, ...otherDetails } = user._doc;

      res
          .cookie("access_token", token, {
              httpOnly: true,
              sameSite: 'lax',
          })
          .status(200)
          .json({
              success: true,
              message: 'Login successful',
              data: {
                  details: { ...otherDetails },
                  isAdmin: user.isAdmin
              }
          });
  } catch (error) {
      console.error('Login error:', error);
      res.status(400).json({
          success: false,
          message: 'Login failed',
          error: error.message
      });
  }
});

app.get('/profile', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    const { password, ...userData } = user._doc;
    res.status(200).json({
      success: true,
      data: userData
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message
    });
  }
});

app.put('/profile', verifyUser, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      req.body,
      { new: true }
    );
    const { password, ...userData } = user._doc;

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: userData
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
});

app.get('/addresses', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    res.status(200).json({
      success: true,
      data: user.addresses
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to fetch addresses',
      error: error.message
    });
  }
});

app.post('/addresses', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    user.addresses.push(req.body);
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: user.addresses
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to add address',
      error: error.message
    });
  }
});

app.put('/addresses/:addressId', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const address = user.addresses.id(req.params.addressId);
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }
    Object.assign(address, req.body);
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: address
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to update address',
      error: error.message
    });
  }
});

app.delete('/addresses/:addressId', verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const address = user.addresses.id(req.params.addressId);
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }
    address.remove();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to delete address',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
    console.log(`User service running on ${PORT}`);
  });