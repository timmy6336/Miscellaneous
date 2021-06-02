//testing useing supertest and jest

const request = require('supertest')
const app = require('../src/app')


//a test for successfully pinging the server
test('Pinging the server test: Success', async () => {
    const response = await request(app)
        .get('/api/ping')
        .expect(200)
})
//a test for successfully sending a /posts request
test('Sending a request to /posts: success', async () => {
    const response = await request(app)
        .get('/api/posts')
        .query(
            {
                tags: 'history,tech',
                sortBy: 'likes',
                direction: 'desc'
            })
        .expect(200)
        .expect('Content-Type', /json/)
})
//testing that an appropriate error is returned when no tag is provided
test('Sending a request to /posts: failure, no tag provided', async () => {
    const response = await request(app)
        .get('/api/posts')
        .query(
            {
                sortBy: 'likes',
                direction: 'desc'
            })
        .expect(400, {"Error":'Tag parameter is required'})
})
//testing that an appropriate error is returned when an invalid sortBy parameter is supplied
test('Sending a request to /posts: failure, invalid sortBy parameter', async () => {
    const response = await request(app)
        .get('/api/posts')
        .query(
            {
                tags: 'history,tech',
                sortBy: 'likess',
                direction: 'desc'
            })
        .expect(400, {"Error": 'sortBy parameter is invalid'})
})
//testing that an appropriate error is returned when an invalid parameter parameter is supplied
test('Sending a request to /posts: failure, invalid direction parameter', async () => {
    const response = await request(app)
        .get('/api/posts')
        .query(
            {
                tags: 'history,tech',
                sortBy: 'likes',
                direction: 'descc'
            })
        .expect(400, {"Error" : 'direction parameter is invalid'})
})