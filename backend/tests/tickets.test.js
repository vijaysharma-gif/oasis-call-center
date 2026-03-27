const request = require('supertest');
const app     = require('../src/server');

let token;
let ticketId;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/login').send({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  });
  token = res.body.token;
});

afterAll(async () => {
  if (ticketId) {
    await request(app)
      .delete(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`);
  }
});

describe('Tickets API', () => {
  test('GET /api/tickets — requires auth', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  test('GET /api/tickets — returns tickets list', async () => {
    const res = await request(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tickets)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  test('POST /api/tickets — creates ticket', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name:   'Test Customer',
        customer_number: '9999999999',
        title:           'Test Ticket',
        category:        'General Inquiry',
        priority:        'Low',
      });
    expect(res.status).toBe(201);
    expect(res.body.ticket_number).toMatch(/^TKT-\d{4}$/);
    ticketId = res.body.id;
  });

  test('POST /api/tickets — rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: 'No Title' });
    expect(res.status).toBe(400);
  });

  test('GET /api/tickets/:id — returns ticket', async () => {
    if (!ticketId) return;
    const res = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Test Ticket');
  });

  test('PATCH /api/tickets/:id — updates status', async () => {
    if (!ticketId) return;
    const res = await request(app)
      .patch(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'In Progress' });
    expect(res.status).toBe(200);
  });

  test('POST /api/tickets/:id/note — adds note', async () => {
    if (!ticketId) return;
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/note`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'This is a test note' });
    expect(res.status).toBe(200);
  });

  test('GET /api/tickets/:id — ticket has timeline entry', async () => {
    if (!ticketId) return;
    const res = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.timeline)).toBe(true);
    expect(res.body.timeline.length).toBeGreaterThan(0);
  });

  test('DELETE /api/tickets/:id — deletes ticket', async () => {
    if (!ticketId) return;
    const res = await request(app)
      .delete(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    ticketId = null;
  });

  test('GET /api/tickets/:id — 404 after delete', async () => {
    const res = await request(app)
      .get('/api/tickets/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
