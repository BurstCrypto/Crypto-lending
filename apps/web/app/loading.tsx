export default function ApplicationLoading() {
  return (
    <main className="page-shell portfolio-page-shell">
      <section id="main-content" className="portfolio-state-card">
        <div role="status" aria-live="polite" aria-busy="true">
          <div className="portfolio-loading-mark" aria-hidden="true" />
          <h1>Loading Bonsai Lending</h1>
          <p>Waiting for the next verified page.</p>
        </div>
      </section>
    </main>
  );
}
