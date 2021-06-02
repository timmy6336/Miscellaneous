//using npm memory-cache
const cache = require('memory-cache')

const memCache = new cache.Cache()

//middleware function to cache similar results for a given duration
const cacheMiddleware = (duration) => {
    return (req, res, next) => {
        //getting a key based on the url for the results
        let key = '__express__' + req.originalUrl || req.originalUrl
        let cacheContent = memCache.get(key)
        //checking if the request was made recently
        if (cacheContent) {
            //parsing the results back to json
            let returnJson = JSON.parse(cacheContent)
            res.send(returnJson)
            return
        }
        //if not requested recently store the results we do get
        else {
            res.sendResponse = res.send
            res.send = (body) => {
                memCache.put(key, body, duration)
                res.sendResponse(body)
            }
            next()
        }
    }
}

module.exports = cacheMiddleware