type ServiceStatusProps = {
  environment: string;
  version: string;
};

export function ServiceStatus({ environment, version }: ServiceStatusProps) {
  return (
    <section className="status-card" aria-labelledby="service-status-title">
      <div className="status-heading">
        <div>
          <p className="eyebrow">System status</p>
          <h2 id="service-status-title">Web application</h2>
        </div>
        <p className="status-badge">
          <span className="status-dot" aria-hidden="true" />
          Ready
        </p>
      </div>

      <dl className="status-details">
        <div>
          <dt>Version</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{environment}</dd>
        </div>
      </dl>

      <nav className="status-links" aria-label="Operational endpoints">
        <a href="/api/health">Health endpoint</a>
        <a href="/api/version">Version endpoint</a>
      </nav>
    </section>
  );
}
