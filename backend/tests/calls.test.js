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

describe('Calls API', () => {
  test('GET /api/calls — requires auth', async () => {
    const res = await request(app).get('/api/calls');
    expect(res.status).toBe(401);
  });

  test('GET /api/calls — returns paginated calls', async () => {
    const res = await request(app)
      .get('/api/calls?limit=10&offset=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.calls)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.calls.length).toBeLessThanOrEqual(10);
  });

  test('GET /api/calls — filters by status=received', async () => {
    const res = await request(app)
      .get('/api/calls?status=received&limit=5')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    res.body.calls.forEach(c => {
      expect(c.agent_answer_time).toBeTruthy();
    });
  });

  test('GET /api/calls — filters by status=missed', async () => {
    const res = await request(app)
      .get('/api/calls?status=missed&limit=5')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    res.body.calls.forEach(c => {
      expect(!c.agent_answer_time || c.agent_answer_time === '').toBe(true);
    });
  });

  test('GET /api/calls — sorts by agent_duration nulls last', async () => {
    const res = await request(app)
      .get('/api/calls?sortBy=agent_duration&sortDir=desc&limit=20')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const durations = res.body.calls.map(c => c.agent_duration);
    // All nulls should be at the end
    let seenNull = false;
    for (const d of durations) {
      if (d === null || d === undefined) seenNull = true;
      else expect(seenNull).toBe(false); // non-null after null is wrong
    }
  });

  test('GET /api/calls — search filters results', async () => {
    const res = await request(app)
      .get('/api/calls?search=9899677276&limit=5')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Every result should match search term
    res.body.calls.forEach(c => {
      const text = [c.caller_number, c.called_number, c.agent_name, c.agent_number].join(' ');
      expect(text).toMatch(/9899677276/);
    });
  });

  test('GET /api/calls/stats/summary — returns stats object', async () => {
    const res = await request(app)
      .get('/api/calls/stats/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.received).toBe('number');
    expect(typeof res.body.missed).toBe('number');
    expect(res.body.received + res.body.missed).toBe(res.body.total);
  });

  test('GET /api/calls/export — returns rows array', async () => {
    const res = await request(app)
      .get('/api/calls/export')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  test('GET /api/calls/:id — returns call by call_id', async () => {
    const listRes = await request(app)
      .get('/api/calls?limit=1')
      .set('Authorization', `Bearer ${token}`);
    const call = listRes.body.calls[0];
    if (!call) return; // skip if DB empty

    const res = await request(app)
      .get(`/api/calls/${call.call_id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.call_id).toBe(call.call_id);
  });

  test('GET /api/calls/:id — 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/calls/nonexistent_id_xyz')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
