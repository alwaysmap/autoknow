import { test, expect } from '../helpers/e2e';

test.describe('Projects API', () => {
  test('should return a list of active projects', async ({ request }) => {
    const response = await request.get('/api/projects');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(Array.isArray(data.projects)).toBeTruthy();
  });
});
