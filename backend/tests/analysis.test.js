const request = require('supertest');
const app     = require('../src/server');

let token;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/login').send({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  });
  token = res.body.token;
});

describe('Analysis API', () => {
  test('GET /api/analysis — requires auth', async () => {
    const res = await request(app).get('/api/analysis');
    expect(res.status).toBe(401);
  });

  test('GET /api/analysis — returns paginated analyses', async () => {
    const res = await request(app)
      .get('/api/analysis?limit=5&offset=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.analyses)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  test('GET /api/analysis — all records have status=completed', async () => {
    const res = await request(app)
      .get('/api/analysis?limit=10')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    res.body.analyses.forEach(a => {
      expect(a.status).toBe('completed');
    });
  });

  test('GET /api/analysis — category filter works', async () => {
    // First get all to find a category
    const all = await request(app)
      .get('/api/analysis?limit=10')
      .set('Authorization', `Bearer ${token}`);
    const category = all.body.analyses.find(a => a.category)?.category;
    if (!category) return;

    const res = await request(app)
      .get(`/api/analysis?category=${encodeURIComponent(category)}&limit=10`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    res.body.analyses.forEach(a => {
      expect(a.category).toBe(category);
    });
  });

  test('GET /api/analysis — each record has call data joined', async () => {
    const res = await request(app)
      .get('/api/analysis?limit=5')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    res.body.analyses.forEach(a => {
      // call may be null if no matching call, but field should exist
      expect('call' in a).toBe(true);
    });
  });

  test('GET /api/analysis/:call_id — returns 404 for unknown call_id', async () => {
    const res = await request(app)
      .get('/api/analysis/nonexistent_call_id_xyz')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/analysis/:call_id — returns analysis for known call_id', async () => {
    const listRes = await request(app)
      .get('/api/analysis?limit=1')
      .set('Authorization', `Bearer ${token}`);
    const analysis = listRes.body.analyses[0];
    if (!analysis) return;

    const res = await request(app)
      .get(`/api/analysis/${analysis.call_id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.call_id).toBe(analysis.call_id);
  });
});
