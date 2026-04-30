import request from 'supertest';
import app from '../../src/server';

describe('Health Route', () => {
  it('GET /api/health should return status ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.provider).toBeDefined();
    expect(res.body.model).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('LLM Routes', () => {
  it('POST /api/llm/stream should return 400 without goal', async () => {
    const res = await request(app)
      .post('/api/llm/stream')
      .send({ pageContext: null, chatHistory: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('goal is required');
  });
});

describe('Form Routes', () => {
  it('POST /api/forms/plan should return 400 without goal', async () => {
    const res = await request(app)
      .post('/api/forms/plan')
      .send({ forms: [], chatHistory: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('goal is required');
  });
});

describe('Config Routes', () => {
  it('POST /api/config/update should update model', async () => {
    const res = await request(app)
      .post('/api/config/update')
      .send({ model: 'gpt-3.5-turbo' });

    expect(res.status).toBe(200);
    expect(res.body.model).toBe('gpt-3.5-turbo');
  });
});