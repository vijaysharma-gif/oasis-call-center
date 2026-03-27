const request = require('supertest');
const app     = require('../src/server');

let token;
let createdId;
const TEST_AGENT_NUMBER = `TEST${Date.now()}`;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/login').send({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  });
  token = res.body.token;
});

afterAll(async () => {
  if (createdId) {
    await request(app)
      .delete(`/api/agents/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
  }
});

describe('Agents API', () => {
  test('GET /api/agents — requires auth', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(401);
  });

  test('GET /api/agents — returns agents list', async () => {
    const res = await request(app)
      .get('/api/agents')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.agents)).toBe(true);
  });

  test('GET /api/agents/unverified — returns unverified agents', async () => {
    const res = await request(app)
      .get('/api/agents/unverified')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.unverified)).toBe(true);
  });

  test('POST /api/agents — creates agent', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Agent', agent_number: TEST_AGENT_NUMBER });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Agent');
    createdId = res.body.id;
  });

  test('POST /api/agents — rejects duplicate agent_number', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Duplicate', agent_number: TEST_AGENT_NUMBER });
    expect(res.status).toBe(409);
  });

  test('POST /api/agents — rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Number' });
    expect(res.status).toBe(400);
  });

  test('PUT /api/agents/:id — updates agent name', async () => {
    if (!createdId) return;
    const res = await request(app)
      .put(`/api/agents/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Agent' });
    expect(res.status).toBe(200);
  });

  test('DELETE /api/agents/:id — deletes agent', async () => {
    if (!createdId) return;
    const res = await request(app)
      .delete(`/api/agents/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    createdId = null;
  });
});
