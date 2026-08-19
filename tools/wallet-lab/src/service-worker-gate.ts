type ServiceWorkerBoundary = Pick<ServiceWorkerContainer, 'controller' | 'getRegistrations'>;

export async function assertNoServiceWorkerContext(
  serviceWorker: ServiceWorkerBoundary | undefined,
): Promise<void> {
  if (!serviceWorker) return;
  if (serviceWorker.controller) {
    throw new Error('service-worker-controller-present');
  }
  const registrations = await serviceWorker.getRegistrations();
  if (registrations.length > 0) {
    throw new Error('service-worker-registration-present');
  }
}
