type ServiceStatusProps = {
  environment: string;
  version: string;
};

export function ServiceStatus({ environment, version }: ServiceStatusProps) {
  return (
    <section className="status-card service-status" aria-labelledby="service-status-title">
      <div className="status-heading service-status__heading">
        <div className="service-status__title">
          <p className="eyebrow">Application</p>
          <h2 id="service-status-title">Application details</h2>
        </div>
        <p className="status-badge" role="status">
          <span className="status-dot" aria-hidden="true" />
          Page ready
        </p>
      </div>

      <dl className="status-details service-status__details">
        <div>
          <dt>Version</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{environment}</dd>
        </div>
      </dl>

      <nav className="status-links service-status__links" aria-label="Operational endpoints">
        <a href="/api/health">Health endpoint</a>
        <a href="/api/version">Version endpoint</a>
      </nav>
    </section>
  );
}
