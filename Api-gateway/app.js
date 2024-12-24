const express = require('express')
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer();

const app = express();

const BASE_PATH = '/api/v1';

app.use(`${BASE_PATH}/users`, (req, res) => {
    console.log("users")
    proxy.web(req, res, { target: 'http://user-service:7001' });
})

app.use(`${BASE_PATH}/products`, (req, res) => {
    console.log('products')
    proxy.web(req, res, { target: 'http://product-service:7002' });
})

app.use(`${BASE_PATH}/carts`, (req, res) => {
    console.log('carts')
    proxy.web(req, res, { target: 'http://cart-service:7003' });
})

app.use(`${BASE_PATH}/categories`, (req, res) => {
    console.log('categories')
    proxy.web(req, res, { target: 'http://category-service:7004' });
});

app.use(`${BASE_PATH}/orders`, (req, res) => {
    console.log('orders')
    proxy.web(req, res, { target: 'http://order-service:7005' });
});

app.use(`${BASE_PATH}/search`, (req, res) => {
    console.log('search')
    proxy.web(req, res, { target: 'http://search-service:7006' });
});

const PORT = 7000;
app.listen(PORT, () => console.log(`API GATEWAY STARTED ON PORT ${PORT}`))