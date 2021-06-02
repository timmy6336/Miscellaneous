//the api route

//Using express npm for the server
const { response } = require('express')
const express = require('express')
//Using node-fetch npm for making api requests
const fetch = require('node-fetch')

//the express router
const router = new express.Router

/**
 * @api {get} /ping pings the server
 * @apiName Ping
 * @apiGroup Api
 *
 *
 *
 * @apiSuccess (Success 200) {boolean} success true when there is a successful response
 *
 * @apiError (400) {String} err, the body of the error
 */
router.get('/ping', async (req, res) => {
    try {
        res.status(200).send(
            {
                "success": true
            }
        )
    }
    catch (err) {
        res.status(400).send({'Error': err})
    }
})

/**
 * @api {get} /posts Resquest to get all posts with given tags
 * @apiName Posts
 * @apiGroup Api
 * 
 * @apiParamExample {json} Request-Query-Example:
 *      localHost:3000/api/posts?tags=history,tech&sortBy=likes&direction=desc
 * 
 * @apiSuccess (Success 200) {Object[]} a formated list of all the posts returned
 *
 * @apiError (400) {String} message "Tag parameter is require"
 * @apiError (400) {String} message "direction parameter is invalid"
 * @apiError (400) {String} message "sortBy parameter is invalid"
 */
router.get('/posts', (req, res) => {
    try{
        if (!req.query.tags) {
            throw new Error("Tag parameter is required")
        }
        const direction = getDirection(req.query.direction)
        const sortBy = getSortBy(req.query.sortBy)
        const tags = req.query.tags.split(',')
        const promises = []
        var posts = []
        for(let i = 0; i < tags.length; i++)
        {
            promises.push(getPosts(tags[i]))
        }
        Promise.all(promises).then(response => response.forEach(
            response => posts = posts.concat(response)
        )).then(response => {
            posts = filterById(posts)
            res.status(200).send(
            {
                "posts": posts.sort(sortOrder(sortBy, direction))
            })
        })

    }
    catch (err) {
        res.status(400).send({'Error': err.message})
    }
})

//a method to define how we are sorting our list
const sortOrder = (sortBy, direction) => {
    const dir = direction === 'desc' ? -1 : 1
    return (entry1, entry2) => {
        if (entry1[sortBy] > entry2[sortBy]) return dir
        else if (entry1[sortBy] < entry2[sortBy]) return -dir
        return 0
    }
}

const getDirection = (direction) =>
{
    const validDir = ['asc', 'desc']
    if (direction) {
        if (!validDir.includes(direction)) {
            throw new Error("direction parameter is invalid")
        }
        return direction
    }
    else{return 'asc'}
}

const getSortBy = (sortBy) =>
{
    const validSort = ['id', 'reads', 'likes', 'popularity']
    if (sortBy) {
        if (!validSort.includes(sortBy)) {
            throw new Error("sortBy parameter is invalid")
        }
        return sortBy
    }
    else{return 'id'}
}

const getPosts = async (tag) =>
{
    const response = await fetch('https://api.hatchways.io/assessment/blog/posts?tag=' + tag)
    data = await response.json()
    //console.log(data)
    return data.posts
}

const filterById = (list) =>
{
    const foundIDs = new Set()
    list = list.filter(post => {
        if (!foundIDs.has(post['id'])) {
            foundIDs.add(post['id'])
            return true
        }
        return false
    })
    return list
}
module.exports = router