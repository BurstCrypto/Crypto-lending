import { SERVICE_NAME } from '../constants';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports that the API process is healthy', () => {
    const controller = new HealthController();

    expect(controller.getHealth()).toEqual({
      service: SERVICE_NAME,
      status: 'ok',
    });
  });
});
