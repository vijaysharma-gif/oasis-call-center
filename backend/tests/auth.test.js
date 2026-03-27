const request = require('supertest');
const app     = require('../src/server');

let adminToken;
let agentToken;

describe('Auth', () => {
  test('POST /api/auth/login — rejects missing credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/login — rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/login — admin login succeeds', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('admin');
    adminToken = res.body.token;
  });

  test('POST /api/auth/refresh — returns new token with valid token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  test('POST /api/auth/refresh — rejects missing token', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/refresh — rejects invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
  });
});

module.exports = { getAdminToken: () => adminToken };
