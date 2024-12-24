const express = require('express');
const axios = require('axios');
const { verifyToken } = require('./middleware/auth.js');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 7006;

// Helper function to search products
async function searchProducts(query) {
  try {
    const response = await axios.get(`${process.env.PRODUCT_SERVICE_URL}`, {
      params: { search: query }
    });
    return response.data.map(product => ({
      ...product,
      type: 'product'
    }));
  } catch (error) {
    console.error('Error searching products:', error.message);
    return [];
  }
}

// Helper function to search categories
async function searchCategories(query) {
  try {
    const response = await axios.get(`${process.env.CATEGORY_SERVICE_URL}`);
    return response.data.data
      .filter(category => 
        category.name.toLowerCase().includes(query.toLowerCase()) ||
        (category.description && category.description.toLowerCase().includes(query.toLowerCase()))
      )
      .map(category => ({
        ...category,
        type: 'category'
      }));
  } catch (error) {
    console.error('Error searching categories:', error.message);
    return [];
  }
}

// Helper function to search reviews by product name or content
async function searchReviews(query) {
  try {
    const productsResponse = await axios.get(`${process.env.PRODUCT_SERVICE_URL}`);
    const products = productsResponse.data;
    
    let allReviews = [];
    for (const product of products) {
      try {
        const reviewsResponse = await axios.get(
          `${process.env.PRODUCT_SERVICE_URL}/${product._id}/reviews`
        );
        const reviews = reviewsResponse.data.data
          .filter(review =>
            review.comment.toLowerCase().includes(query.toLowerCase())
          )
          .map(review => ({
            ...review,
            productName: product.name,
            type: 'review'
          }));
        allReviews = [...allReviews, ...reviews];
      } catch (error) {
        console.error(`Error fetching reviews for product ${product._id}:`, error.message);
      }
    }
    return allReviews;
  } catch (error) {
    console.error('Error searching reviews:', error.message);
    return [];
  }
}

app.get('/', verifyToken, async (req, res) => {
  try {
    const { q, type } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search term is required'
      });
    }

    let results = [];

    // If type is specified, search only that type
    // Otherwise search everything
    if (!type || type === 'product') {
      const productResults = await searchProducts(q);
      results = [...results, ...productResults];
    }

    if (!type || type === 'category') {
      const categoryResults = await searchCategories(q);
      results = [...results, ...categoryResults];
    }

    if (!type || type === 'review') {
      const reviewResults = await searchReviews(q);
      results = [...results, ...reviewResults];
    }

    // Sort results by relevance (basic implementation)
    results.sort((a, b) => {
      const aName = a.name || a.productName || '';
      const bName = b.name || b.productName || '';
      const aRelevance = aName.toLowerCase().includes(q.toLowerCase()) ? 2 : 1;
      const bRelevance = bName.toLowerCase().includes(q.toLowerCase()) ? 2 : 1;
      return bRelevance - aRelevance;
    });

    res.status(200).json({
      success: true,
      data: {
        query: q,
        type: type || 'all',
        count: results.length,
        results
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform search',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Search service running on ${PORT}`);
});