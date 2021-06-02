//setting up our routes, in this case we only have the /api route but it is set up to be able to nicely structure multiple routes 
const express = require('express')
const cacheMiddleware = require('./middleware/cache')
//setting it to save results for 30000ms, can be whatever we want
const storeTimer = 30000

const app = express()

app.use(express.json())

app.use('/api', cacheMiddleware(storeTimer), require('./routes/api.js'))

module.exports = app